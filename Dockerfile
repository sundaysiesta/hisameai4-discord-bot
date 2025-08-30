# Node.jsの公式イメージをベースにする（より安定したバージョン）
FROM node:18-alpine

# 必要なパッケージをインストール
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    fontconfig \
    ttf-dejavu \
    && fc-cache -fv

# アプリケーションの作業場所を作成
WORKDIR /app

# npmのキャッシュをクリア
RUN npm cache clean --force

# 最初にパッケージ管理ファイルだけをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --production=false

# Botの全ソースコードを作業場所にコピー
COPY . .

# 不要なファイルを削除してイメージサイズを削減
RUN npm prune --production

# Botを起動するコマンド
CMD ["node", "index.js"]