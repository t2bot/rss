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

LogService.setLevel(LogLevel.TRACE);
LogService.setLogger(new RichConsoleLogger());
LogService.muteModule("Metrics");
LogService.trace = LogService.debug;

let appservice: Appservice;

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
    AutojoinRoomsMixin.setupOnAppservice(appservice);
    appservice.begin().then(() => LogService.info("index", "Appservice started"));
    appservice.on("room.message", (roomId, event) => {
        if (event.type !== "m.room.message") return; // TODO: Extensible events
        if (event.content.msgtype !== "m.text") return;
        if (!event.content.body || !event.content.body.trim().startsWith("!rss")) return;

        const parts = event.content.body.trim().split(" ").filter(p => !!p);
        const command = parts[1]?.toLowerCase();
        const url = parts[2];

        switch(command) {
            case "subscribe":
                return trySubscribe(roomId, event, url);
            case "unsubscribe":
                return tryUnsubscribe(roomId, event, url);
            case "subscriptions":
                return tryListSubscriptions(roomId, event, url);
            default:
                return tryHelp(roomId, event);
        }
    });
})();

function checkPower(roomId: string, sender: string): Promise<boolean> {
    return appservice.botClient.userHasPowerLevelForAction(sender, roomId, PowerLevelAction.Kick);
}

async function trySubscribe(roomId: string, event: any, url: string) {
    if (!(await checkPower(roomId, event.sender))) {
        return appservice.botClient.replyHtmlNotice(roomId, event, `<b>You do not have permission to run this command.</b>Please ask a room moderator to perform it instead.`);
    }

}

async function tryUnsubscribe(roomId: string,  event: any, url: string) {
    if (!(await checkPower(roomId, event.sender))) {
        return appservice.botClient.replyHtmlNotice(roomId, event, `<b>You do not have permission to run this command.</b>Please ask a room moderator to perform it instead.`);
    }

}

async function tryListSubscriptions(roomId: string, event: any, url: string) {

}

async function tryHelp(roomId: string, event: any) {
    await appservice.botClient.replyHtmlNotice(roomId, event, `<b>RSS Bot Help</b><br/>Commands:<ul><li><code>!rss subscribe &lt;url&gt;</code> - Subscribe to a feed.</li><li><code>!rss unsubscribe &lt;url&gt;</code> - Unsubscribe from a feed.</li><li><code>!rss subscriptions</code> - List all subscribed feed URLs.</li></ul>`);
}
