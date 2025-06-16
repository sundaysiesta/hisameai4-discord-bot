module.exports = {
    ANONYMOUS_CHANNEL_ID: '1377834239206096948',
    ANONYMOUS_WEBHOOK_URL: process.env.ANONYMOUS_WEBHOOK_URL,
    STICKY_BUTTON_ID: 'show_anonymous_form',
    ANONYMOUS_MODAL_ID: 'anonymous_post_modal',
    CLUB_CATEGORY_ID: '1369627451801604106',
    CLUB_PANEL_CHANNEL_ID: '1370290635101175879',
    EXCLUDED_CHANNELS: ['1373300449788297217', '1370290635101175879', '1369660410008965203'],
    ROLE_TO_REMOVE_ON_CREATE: '1373302892823580762',
    CREATE_CLUB_BUTTON_ID: 'create_club_button',
    CREATE_CLUB_MODAL_ID: 'create_club_modal',
    RANKING_CHANNEL_ID: '1383261252662595604',
    RANKING_UPDATE_INTERVAL: '*/5 * * * *',
    WORDCLOUD_EXCLUDED_CATEGORY_ID: '1370683406345699369',
    XP_EXCLUDED_ROLE_ID: '1371467046055055432',
    RESTART_NOTIFICATION_CHANNEL_ID: '1369627467991486605',
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    
    // クールダウンを延長
    TEXT_XP_COOLDOWN: 5 * 60 * 1000,    // 5分
    VOICE_XP_COOLDOWN: 5 * 60 * 1000,   // 5分
    TREND_WORD_COOLDOWN: 5 * 60 * 1000, // 5分

    // 【最重要修正】クールダウン延長に合わせて獲得XP量を調整
    VOICE_XP_AMOUNT: 25,     // 10 -> 25    MIN_TEXT_XP: 25,       // 10 -> 25
    MAX_TEXT_XP: 100,      // 40 -> 100
    TREND_WORD_LIFESPAN: 3 * 60 * 60 * 1000, // 6時間から3時間に変更
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
    ]),

    // ロメコイン設定
    COIN_NAME: 'ロメコイン',
    COIN_SYMBOL: '<:romecoin2:1384036538513358849>',
    DAILY_COIN_AMOUNT: 250,
    DAILY_COIN_BOOSTED_AMOUNT: 500,
    DAILY_COOLDOWN: 24 * 60 * 60 * 1000, // 24時間
    CRIME_COOLDOWN: 5 * 60 * 1000, // 5分
    CRIME_COIN_MIN: 50,
    CRIME_COIN_MAX: 300,
    CRIME_FINE_MIN: 50,
    CRIME_FINE_MAX: 100,
    CRIME_SUCCESS_RATE: 0.5, // 50%の成功率
    ROB_COOLDOWN: 6 * 60 * 60 * 1000, // 6時間
    ROB_SUCCESS_RATE: 0.3, // 30%の成功率
    ROB_MIN_PERCENT: 0.3, // 30%
    ROB_MAX_PERCENT: 0.6, // 60%
    TAX_RATE: 0.05, // 5%の税金
    FINANCE_DEPARTMENT_ID: '1095353742506856552', // 財務省のユーザーID
    STARTING_BALANCE: 1000, // 初期残高
    COIN_COMMANDS: {
        DAILY: ['daily', 'デイリー'],
        GIVE: ['give', '送金'],
        BALANCE: ['balance', '残高'],
        LEADERBOARD: ['leaderboard', 'ランキング'],
        SHOP: ['shop', '店'],
        BUY: ['buy', '購入'],
        CRIME: ['crime', '犯罪'],
        DEPOSIT: ['deposit', '預金'],
        WITHDRAW: ['withdraw', '引出'],
        ROB: ['rob', '強奪'],
        ECONOMY: ['economy', '経済'],
        SHOP_MANAGE: ['shopmanage', 'ショップ管理'],
        RESET_ECONOMY: ['reseteco', '経済リセット']
    },
    COIN_ITEMS: [
        { id: 'weather_title', name: '天気予報師の称号', price: 10000, description: '天気予報を見る人の称号' },
        { id: 'lome_master', name: 'ロメの支配者称号', price: 100000, description: 'ロメを支配する者の証' },
        { id: 'custom_role', name: 'カスタムロール', price: 50000, description: '自分だけのロールを作成できます' }
    ],
};
