import { Appservice, LogService } from "matrix-bot-sdk";
import { FeedData, FeedEntry, read as readRss } from "@extractus/feed-extractor";
import * as sanitizeHtml from "sanitize-html";
import { Database } from "./db";

export class RssHandler {

    constructor(private appservice: Appservice, private db: Database, private intervalMs: number) {
        this.scheduleSend();
    }

    private scheduleSend() {
        setTimeout(async () => {
            try {
                const subscriptions = await this.db.allSubscriptions();
                const urlsToRooms = new Map<string, Set<string>>();
                for (const { url, roomId } of subscriptions) {
                    if (!urlsToRooms.has(url)) {
                        urlsToRooms.set(url, new Set<string>());
                    }
                    urlsToRooms.get(url).add(roomId);
                }

                for (const [url, roomIds] of urlsToRooms.entries()) {
                    try {
                        LogService.info("RSS", `Querying ${url} for ${roomIds.size} rooms`);
                        const feedData = await readRss(url, { includeEntryContent: false });
                        const knownEntries = new Set<string>(await this.db.getKnownEntries(url));

                        const entryIds = new Set<string>();
                        for (const entry of feedData.entries) {
                            if (knownEntries.has(entry.id)) {
                                continue;
                            }
                            entryIds.add(entry.id);
                            for (const roomId of roomIds) {
                                try {
                                    await this.sendEntryTo(feedData, entry, roomId);
                                } catch (e) {
                                    LogService.warn("RSS#scheduleSend-sendLoop", "Error sending to", roomId, e);
                                }
                            }
                        }
                        if (entryIds.size > 0) {
                            await this.db.addKnownEntries(url, Array.from(entryIds));
                        }
                    } catch (e) {
                        LogService.warn("RSS#scheduleSend-loop", e);
                    }
                }
            } finally {
                // Manually reschedule (to avoid overlapping loops)
                LogService.debug("RSS", "Scheduling next loop");
                process.nextTick(() => this.scheduleSend());
            }
        }, this.intervalMs);
    }

    public async subscribe(roomId: string, url: string) {
        await this.db.addSubscription(roomId, url);
    }

    public async unsubscribe(roomId: string, url: string) {
        await this.db.removeSubscription(roomId, url);
    }

    public async subscriptionsFor(roomId: string): Promise<string[]> {
        return this.db.urlsForRoom(roomId);
    }

    public async sendEntryTo(feed: FeedData, entry: FeedEntry, roomId: string) {
        const name = feed.link ? `<a href="${encodeURIComponent(feed.link)}">${sanitizeHtml(feed.title ?? "Unknown Feed")}</a>` : sanitizeHtml(feed.title ?? "Unknown Feed");
        const title = entry.link ? `<a href="${encodeURIComponent(entry.link)}">${sanitizeHtml(entry.title ?? "Unknown Post")}</a>` : sanitizeHtml(entry.title ?? "Unknown Post");
        const template = `New post in ${name}: <b>${title}</b>`;
        await this.appservice.botClient.sendHtmlNotice(roomId, template);
    }
}
