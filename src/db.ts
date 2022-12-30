import * as sqlite3 from "sqlite3";
import * as path from "path";
import { LogService } from "matrix-bot-sdk";

export class Database {
    private db: sqlite3.Database;
    private stmtFindByRoomId: sqlite3.Statement;
    private stmtInsertFeed: sqlite3.Statement;
    private stmtInsertSubscription: sqlite3.Statement;
    private stmtSelectFeed: sqlite3.Statement;
    private stmtDeleteSubscription: sqlite3.Statement;
    private stmtSelectSubscriptions: sqlite3.Statement;
    private stmtSelectEntries: sqlite3.Statement;
    private stmtInsertEntry: sqlite3.Statement;

    constructor(storagePath: string) {
        this.db = new sqlite3.Database(path.join(storagePath, "rss.db"));
        this.db.serialize(() => {
            this.db.run("CREATE TABLE IF NOT EXISTS feeds(id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE)");
            this.db.run("CREATE TABLE IF NOT EXISTS entries(feed_id INTEGER NOT NULL, entry_id TEXT NOT NULL, PRIMARY KEY (entry_id, feed_id), FOREIGN KEY (feed_id) REFERENCES feeds(id))");
            this.db.run("CREATE TABLE IF NOT EXISTS subscriptions(room_id TEXT NOT NULL, feed_id INTEGER NOT NULL, PRIMARY KEY (room_id, feed_id), FOREIGN KEY (feed_id) REFERENCES feeds(id))");
            this.stmtFindByRoomId = this.db.prepare("SELECT feeds.url AS url FROM subscriptions JOIN feeds ON feeds.id = subscriptions.feed_id WHERE room_id = ?");
            this.stmtInsertFeed = this.db.prepare("INSERT INTO feeds(url) VALUES (?) ON CONFLICT (url) DO NOTHING");
            this.stmtInsertSubscription = this.db.prepare("INSERT INTO subscriptions(room_id, feed_id) VALUES (?, ?) ON CONFLICT (room_id, feed_id) DO NOTHING");
            this.stmtSelectFeed = this.db.prepare("SELECT id FROM feeds WHERE url = ?");
            this.stmtDeleteSubscription = this.db.prepare("DELETE FROM subscriptions WHERE room_id = ? AND feed_id = ?");
            this.stmtSelectSubscriptions = this.db.prepare("SELECT feeds.url AS url, subscriptions.room_id AS room_id FROM subscriptions JOIN feeds ON feeds.id = subscriptions.feed_id");
            this.stmtSelectEntries = this.db.prepare("SELECT entry_id FROM entries WHERE feed_id = ?");
            this.stmtInsertEntry = this.db.prepare("INSERT INTO entries(feed_id, entry_id) VALUES (?, ?)");
        });
    }

    public async allSubscriptions(): Promise<{ url: string, roomId: string }[]> {
        return new Promise((resolve, reject) => {
            this.stmtSelectSubscriptions.all((err, rows) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows.map(r => ({ url: r['url'], roomId: r['room_id'] })));
            });
        });
    }

    public async urlsForRoom(roomId: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.stmtFindByRoomId.all(roomId, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows.map(r => r['url']));
            });
        });
    }

    public async addSubscription(roomId: string, feedUrl: string) {
        return new Promise<void>((resolve, reject) => {
            this.db.serialize(() => {
                this.stmtInsertFeed.run(feedUrl, err => {
                    if (err) {
                        return reject(err);
                    }
                });
                this.stmtSelectFeed.get(feedUrl, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!row) {
                        return reject(new Error("No row returned"));
                    }
                    const feedId = row['id'];

                    this.stmtInsertSubscription.run([roomId, feedId], err => {
                        if (err) {
                            return reject(err);
                        }
                        resolve();
                    });
                });
            });
        });
    }

    public async removeSubscription(roomId: string, feedUrl: string) {
        return new Promise<void>((resolve, reject) => {
            this.db.serialize(() => {
                this.stmtSelectFeed.get(feedUrl, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!row) {
                        return reject(new Error("No row returned"));
                    }
                    const feedId = row['id'];

                    this.stmtDeleteSubscription.run([roomId, feedId], err => {
                        if (err) {
                            return reject(err);
                        }
                        resolve();
                    });
                });
            });
        });
    }

    public async getKnownEntries(feedUrl: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.stmtSelectFeed.get(feedUrl, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!row) {
                        return reject(new Error("No row returned"));
                    }
                    const feedId = row['id'];

                    this.stmtSelectEntries.all(feedId, (err, rows) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(rows.map(r => r['entry_id']));
                    });
                });
            });
        });
    }

    public async addKnownEntries(feedUrl: string, ids: string[]) {
        return new Promise<void>((resolve, reject) => {
            this.db.serialize(() => {
                this.stmtSelectFeed.get(feedUrl, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!row) {
                        return reject(new Error("No row returned"));
                    }
                    const feedId = row['id'];

                    for (const entryId of ids) {
                        this.stmtInsertEntry.run([feedId, entryId]);
                    }

                    resolve();
                });
            });
        });
    }
}
