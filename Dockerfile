# Node.jsの公式イメージをベースにする
FROM node:18-slim

# 【修正】日本語フォント(Noto Sans JP)をインストールする手順を追加
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# アプリケーションの作業場所を作成
WORKDIR /app

# 最初にパッケージ管理ファイルだけをコピー
COPY package*.json ./

# 本番環境向けの、より信頼性の高いインストールコマンドを使用する
RUN npm ci --only=production

# Botの全ソースコードを作業場所にコピー
COPY . .

# メモリ制限とガベージコレクションを有効にしてBotを起動
CMD ["node", "--max-old-space-size=512", "--expose-gc", "index.js"]