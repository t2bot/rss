import {
    Appservice,
    AutojoinRoomsMixin,
    IAppserviceOptions,
    IAppserviceRegistration,
    LogLevel,
    LogService,
    MatrixClient,
    PowerLevelAction,
    RichConsoleLogger,
    RustSdkAppserviceCryptoStorageProvider,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy,
    UserID,
} from "matrix-bot-sdk";
import config from "./config";
import * as path from "path";
import { read as readRss } from "@extractus/feed-extractor";
import { RssHandler } from "./rss";
import * as sanitizeHtml from "sanitize-html";
import { Database } from "./db";

LogService.setLevel(LogLevel.TRACE);
LogService.setLogger(new RichConsoleLogger());
LogService.muteModule("Metrics");
LogService.trace = LogService.debug;

let appservice: Appservice;
let rss: RssHandler;
let db: Database;

(async function() {
    const tempClient = new MatrixClient(config.homeserver.url, config.homeserver.asToken);
    const botUser = new UserID(await tempClient.getUserId());

    const registration: IAppserviceRegistration = {
        as_token: config.homeserver.asToken,
        hs_token: config.bot.hsToken,
        sender_localpart: botUser.localpart,
        namespaces: {
            users: [{
                // We don't actually use this, but the bot-sdk requires it.
                regex: `@${botUser.localpart}.+:${botUser.domain}`,
                exclusive: true,
            }],
            rooms: [],
            aliases: [],
        },
    };

    const options: IAppserviceOptions = {
        bindAddress: config.bot.bindAddress,
        port: config.bot.bindPort,
        homeserverName: botUser.domain,
        homeserverUrl: config.homeserver.url,
        registration: registration,
        joinStrategy: new SimpleRetryJoinStrategy(),
        storage: new SimpleFsStorageProvider(path.join(config.bot.storagePath, "appservice.json")),
        cryptoStorage: new RustSdkAppserviceCryptoStorageProvider(path.join(config.bot.storagePath, "crypto")),
    };

    appservice = new Appservice(options);
    db = new Database(config.bot.storagePath);
    rss = new RssHandler(appservice, db, config.rss.updateMs);
    AutojoinRoomsMixin.setupOnAppservice(appservice);
    appservice.begin().then(() => LogService.info("index", "Appservice started"));
    appservice.on("room.message", async (roomId, event) => {
        if (event.type !== "m.room.message") return; // TODO: Extensible events
        if (event.content.msgtype !== "m.text") return;
        if (!event.content.body || !event.content.body.trim().startsWith("!rss")) return;

        const parts = event.content.body.trim().split(" ").filter(p => !!p);
        const command = parts[1]?.toLowerCase();
        const url = parts[2];

        await appservice.botClient.sendReadReceipt(roomId, event.event_id);

        switch(command) {
            case "subscribe":
                return trySubscribe(roomId, event, url);
            case "unsubscribe":
                return tryUnsubscribe(roomId, event, url);
            case "subscriptions":
                return tryListSubscriptions(roomId, event);
            default:
                return tryHelp(roomId, event);
        }
    });

    // cheat to cause encryption to update immediately
    appservice.botIntent.enableEncryption().then(() => LogService.info("index", "Encryption prepared"));
})();

function checkPower(roomId: string, sender: string): Promise<boolean> {
    return appservice.botClient.userHasPowerLevelForAction(sender, roomId, PowerLevelAction.Kick);
}

async function trySubscribe(roomId: string, event: any, url: string) {
    if (!(await checkPower(roomId, event.sender))) {
        return appservice.botClient.replyHtmlNotice(roomId, event, `<b>You do not have permission to run this command.</b>Please ask a room moderator to perform it instead.`);
    }

    try {
        await readRss(url, { includeEntryContent: false }); // validate feed
        await rss.subscribe(roomId, url);
        await reactTo(roomId, event, '✅');
    } catch (e) {
        LogService.error("index", e);
        return appservice.botClient.replyHtmlNotice(roomId, event, `<b>There was an error handling your RSS subscription.</b><br/>Is the URL a valid RSS, Atom, or JSON feed?`);
    }
}

async function tryUnsubscribe(roomId: string,  event: any, url: string) {
    if (!(await checkPower(roomId, event.sender))) {
        return appservice.botClient.replyHtmlNotice(roomId, event, `<b>You do not have permission to run this command.</b>Please ask a room moderator to perform it instead.`);
    }
    await rss.unsubscribe(roomId, url);
    await reactTo(roomId, event, '✅');
}

async function tryListSubscriptions(roomId: string, event: any) {
    const urls = await rss.subscriptionsFor(roomId);
    if (!urls || !urls.length) return appservice.botClient.replyHtmlNotice(roomId, event, `No subscriptions.`);
    return appservice.botClient.replyHtmlNotice(roomId, event, `Subscriptions:<ul><li>${urls.map(u => sanitizeHtml(u)).join(`</li><li>`)}</li>`);
}

async function tryHelp(roomId: string, event: any) {
    await appservice.botClient.replyHtmlNotice(roomId, event, `<b>RSS Bot Help</b><br/>Commands:<ul><li><code>!rss subscribe &lt;url&gt;</code> - Subscribe to a feed.</li><li><code>!rss unsubscribe &lt;url&gt;</code> - Unsubscribe from a feed.</li><li><code>!rss subscriptions</code> - List all subscribed feed URLs.</li></ul>`);
}

function reactTo(roomId: string, event: any, reaction: string): Promise<unknown> {
    return appservice.botClient.sendRawEvent(roomId, "m.reaction", {
        "m.relates_to": {
            event_id: event.event_id,
            key: reaction,
            rel_type: "m.annotation",
        },
    });
}
