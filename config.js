module.exports = {
    ANONYMOUS_CHANNEL_ID: '1377834239206096948',
    ANONYMOUS_WEBHOOK_URL: process.env.ANONYMOUS_WEBHOOK_URL,
    ADMIN_LOG_CHANNEL_ID: process.env.ADMIN_LOG_CHANNEL_ID || '1377834239206096948', // 管理者ログチャンネルID
    CLUB_CATEGORY_ID: '1431905157926359160',
    CLUB_CATEGORY_ID_2: '1431905160128626777', // 部室カテゴリー2
    CLUB_CATEGORIES: ['1431905157926359160', '1431905160128626777'], // 部室カテゴリー一覧
    INACTIVE_CLUB_CATEGORY_ID: '1415923694630469732', // 廃部候補カテゴリID
    POPULAR_CLUB_CATEGORY_ID: '1431905157741805582', // 人気部活カテゴリID
    ARCHIVE_CATEGORY_ID: '1431905161793769529', // アーカイブカテゴリID（🎞｜アーカイブ2）
    ARCHIVE_OVERFLOW_CATEGORY_ID: '1431905163458773050', // アーカイブオーバーフローカテゴリID（50個超過時）
    CLUB_PANEL_CHANNEL_ID: '1431905157741805580',
    EXCLUDED_CHANNELS: ['1373300449788297217', '1431905157741805580', '1369660410008965203'],
    ROLE_TO_REMOVE_ON_CREATE: '1373302892823580762',
    CREATE_CLUB_BUTTON_ID: 'create_club_button',
    CREATE_CLUB_MODAL_ID: 'create_club_modal',
    WORDCLOUD_EXCLUDED_CATEGORY_ID: '1370683406345699369',
    RESTART_NOTIFICATION_CHANNEL_ID: '1431905157657923646',
    MAIN_CHANNEL_ID: '1431905157657923646', // メインチャンネルID
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    // 部活ランキング更新設定（週1回、日曜日の午前0時JSTに更新）
    CLUB_RANKING_UPDATE_CRON: '0 0 * * 0',
    // 廃部候補判定設定
    INACTIVE_CLUB_THRESHOLD: 5, // 週間メッセージ数がこの値以下の部活を廃部候補とする
    // 復活条件設定
    REVIVAL_MIN_ACTIVITY_SCORE: 10, // 復活に必要な最小アクティブポイント
    REVIVAL_MIN_ACTIVE_MEMBERS: 2, // 復活に必要な最小アクティブ部員数
    REVIVAL_MIN_MESSAGE_COUNT: 5, // 復活に必要な最小メッセージ数
    // メモリ管理設定
    MEMORY_CLEANUP_INTERVAL: 60 * 60 * 1000, // 1時間ごと
    ANONYMOUS_COOLDOWN_EXPIRY: 24 * 60 * 60 * 1000, // 24時間
    PROXY_DELETE_MAP_EXPIRY: 7 * 24 * 60 * 60 * 1000, // 7日間
    // 部活作成のクールダウン設定（7日間）
    CLUB_CREATION_COOLDOWN: 7 * 24 * 60 * 60 * 1000, // 7日間
    // メンション機能用設定
    MENTION_COOLDOWN: 30 * 1000, // 30秒（anonymousと同じ）
    MENTION_HELP_COOLDOWN: 5 * 60 * 1000, // 5分（説明表示用）
    MENTION_MAX_LENGTH: 144, // 最大文字数（anonymousと同じ）
    // ファイルサイズ制限設定
    MAX_FILE_SIZE: 25 * 1024 * 1024, // 25MB（Discordの制限）
    MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10MB（画像用）
    MAX_VIDEO_SIZE: 25 * 1024 * 1024, // 25MB（動画用）
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
    PHRASES_TO_COMBINE: ['確認してください', 'よろしくお願いします'],
    STOP_WORDS: new Set([
        'する', 'いる', 'なる', 'れる', 'ある', 'ない', 'です', 'ます', 'こと', 'もの',
        'それ', 'あれ', 'これ', 'よう', 'ため', 'さん', 'せる', 'から', 'ので', 'まで',
        'など', 'て', 'に', 'を', 'は', 'が', 'の', 'と', 'も', 'で', 'だ', 'な', 'か',
        'ね', 'よ', 'や', 'じゃ', 'でしょ', 'でしょう', 'ました', 'でした', 'しょう',
        'てる', 'いる', 'いった', 'られる', 'なかっ', 'ください', 'られ', 'なっ', '思う',
        '思います', 'あり', 'なっ', 'あっ', '来', 'あり', 'もう', 'なろ', 'やっ',
        'なっ', 'なれ', 'でき', 'しまっ', 'みたい', 'ください', 'たら', 'だけ',
        'だけど', 'けど', 'でも', 'って', '的な', 'たい', 'なく', 'たん', 'こら', 
        'ところ', 'しか', 'もり', 'より', 'なに', 'だっ', 'かも', 'かい', 'ねえ', 'できる',
        'なら', 'だろ', 'いい', '言わ', '言っ', 'がっ', 'かっ', '行っ', 'まし', 'すぎ', '知っ',
        '思っ', '見', '見れ', '見せ', 'やっ', 'やれ', 'やろ', 'あっ', 'なっ', '行か', '来', '来れ',
        'なきゃ', 'そう', 'そんな', 'こんな', 'ほんと', 'たわ', '入っ', '使っ', 'にち',
        'ませ', 'よね', 'わけ', 'みたい', '感じ', 'うち', '感じ', 'とりあえず', 'ちゃん', 'くん',
        'めちゃ', 'めっちゃ', 'みたい', 'みたいな', 'ただ', 'ほぼ', 'まぁ', 'なんか',
        'この', 'その', 'あの', 'どの', 'ここ', 'そこ', 'あそこ', 'どこ', '私', 'あなた',
        '彼', '彼女', '自分', '僕', '俺', 'どう', 'そう', 'こう', 'ああ',
        '思う', 'いう', '感じ', 'やつ', 'なんか', 'みんな', 'マジ', '本当', '普通', 'なん', '人',
        '感じ', '為', '事', '物', '者', '方', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
        'w', '笑', 'https', 'http', 'jp', 'co', 'com'
    ])
};
