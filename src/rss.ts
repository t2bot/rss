import { Appservice } from "matrix-bot-sdk";
import * as AsyncLock from "async-lock";
import { FeedData, FeedEntry } from "@extractus/feed-extractor";
import * as sanitizeHtml from "sanitize-html";

const LOCK_KEY = ".";
const ACCOUNT_DATA_URLS = "io.t2bot.rss";

export class RssHandler {
    private urls = new Map<string, Set<string>>();
    private urlLock = new AsyncLock() as {
        acquire: <T>(key: string, fn: () => Promise<T>) => Promise<T>,
    };

    constructor(private appservice: Appservice) {
        // noinspection JSIgnoredPromiseFromCall
        this.urlLock.acquire(LOCK_KEY, async () => {
            const roomIds = await this.appservice.botClient.getJoinedRooms();
            for (const roomId of roomIds) {
                await this.internalReloadRoom(roomId);
            }
        });
    }

    public async reloadRoom(roomId: string) {
        return this.urlLock.acquire(LOCK_KEY, async () => {
            await this.internalReloadRoom(roomId);
        });
    }

    private async internalReloadRoom(roomId: string) {
        try {
            const { urls } = await this.appservice.botClient.getRoomAccountData(ACCOUNT_DATA_URLS, roomId) as any;
            if (urls) {
                for (const url of urls) {
                    await this.internalSubscribe(roomId, url);
                }
            }
            await this.persist(roomId);
        } catch (e) {
            // ignore all errors
        }
    }

    public async subscribe(roomId: string, url: string) {
        await this.urlLock.acquire(LOCK_KEY, async () => {
            await this.internalSubscribe(roomId, url);
            await this.persist(roomId);
        });
    }

    private async internalSubscribe(roomId: string, url: string) {
        if (!this.urls.has(url)) {
            this.urls.set(url, new Set<string>());
        }
        this.urls.get(url).add(roomId);
    }

    public async unsubscribe(roomId: string, url: string) {
        await this.urlLock.acquire(LOCK_KEY, async () => {
            if (this.urls.has(url)) {
                this.urls.get(url).delete(roomId);
                await this.persist(roomId);
            }
        });
    }

    public async subscriptionsFor(roomId: string): Promise<string[]> {
        // This could probably be more efficient
        return this.urlLock.acquire(LOCK_KEY, async () => {
            const roomUrls = new Set<string>();
            for (const [url, roomIds] of this.urls.entries()) {
                if (roomIds.has(roomId)) {
                    roomUrls.add(url);
                }
            }
            return Array.from(roomUrls);
        });
    }

    public async sendEntryTo(feed: FeedData, entry: FeedEntry, roomId: string) {
        const name = feed.link ? `<a href="${encodeURIComponent(feed.link)}">${sanitizeHtml(feed.title ?? "Unknown Feed")}</a>` : sanitizeHtml(feed.title ?? "Unknown Feed");
        const title = entry.link ? `<a href="${encodeURIComponent(entry.link)}">${sanitizeHtml(entry.title ?? "Unknown Post")}</a>` : sanitizeHtml(entry.title ?? "Unknown Post");
        const template = `New post in ${name}: <b>${title}</b>`;
        await this.appservice.botClient.sendHtmlNotice(roomId, template);
    }

    private async persist(roomId?: string) {
        // Reverse the map
        const roomUrls = new Map<string, Set<string>>();
        for (const [url, roomIds] of this.urls.entries()) {
            for (const roomId of roomIds) {
                if (!roomUrls.has(roomId)) {
                    roomUrls.set(roomId, new Set<string>());
                }
                roomUrls.get(roomId).add(url);
            }
        }

        if (roomId) {
            let persistUrls = roomUrls.get(roomId);
            if (!persistUrls) persistUrls = new Set<string>();
            await this.appservice.botClient.setRoomAccountData(ACCOUNT_DATA_URLS, roomId, { urls: Array.from(persistUrls) });
        } else {
            for (const [roomId, persistUrls] of roomUrls.entries()) {
                await this.appservice.botClient.setRoomAccountData(ACCOUNT_DATA_URLS, roomId, { urls: Array.from(persistUrls) });
            }
        }
    }
}
