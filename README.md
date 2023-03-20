# rss

RSS bot (appservice) for t2bot.io | https://t2bot.io/rssbot

## Building

```bash
# 1. Clone the repo (however you want to do that)
git clone https://github.com/t2bot/rss.git && cd rss

# 2. Install dependencies
npm install

# 3. Edit the config
cp config/default.yaml config/development.yaml
nano config/development.yaml

# 4. Run it
npm run start  
```

## Running

Copy and edit `config/default.yaml` then use something similar to the following:

```bash
docker run --restart=always -d --name rss -v /path/to/config.yaml:/app/config/production.yaml -v /path/to/storage:/data -p 8080:9000 ghcr.io/t2bot/rss:main
```
