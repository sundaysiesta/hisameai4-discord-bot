#!/bin/sh
# スクリプトが途中で失敗したら、そこで停止する
set -e

# コミットメッセージが指定されていない場合はエラーを出す
if [ -z "$1" ]; then
  echo "エラー: コミットメッセージを指定してください。"
  echo "使い方: ./gpush.sh \"コミットメッセージ\""
  exit 1
fi

# git add, commit, push を実行
echo "🔄 変更をステージングしています..."
git add .

echo "📦 コミットしています..."
git commit -m "$1"

echo "🚀 GitHubへpushしています..."
git push

echo "✅ 全ての処理が完了しました！"