import * as config from "config";

interface IConfig {
    homeserver: {
        url: string;
        asToken: string;
    };
    bot: {
        bindAddress: string;
        bindPort: number;
        hsToken: string;
        storagePath: string;
    };
    rss: {
        updateMs: number;
    };
}

export default <IConfig>config;
