(function () {
  const DEFAULT_INDUSTRY = "pasela";
  const DEFAULT_SCENE = "food";
  const DEFAULT_ZONE = "left";

  const DEMOS = {
    "anshin-oyado": {
      label: "安心お宿",
      theme: "theme-anshin-oyado",
      descriptor: "館内案内・温浴・近隣広告",
      scenes: {
        wide: {
          label: "3面ワイド",
          zones: {
            wide: {
              eyebrow: "ANSHIN OYADO GUIDE WALL",
              headline: "館内の迷いを減らし、滞在価値を上げる。",
              lead: "入口、休憩スペース、エレベーター前で館内案内とアップセルを自然に見せる。",
              highlight: "Guide / Sauna / Local Ads / QR",
              chips: ["館内案内", "サウナ休憩", "近隣広告", "QR導線"],
              stats: [["4", "訴求テーマ"], ["3", "画面連動"], ["24h", "館内案内"]],
              visual: "wide",
              qr: {
                label: "館内案内QRサンプル",
                title: "館内マップ",
                url: "https://misell.example/demo/anshin-oyado",
                note: "実導入時は施設別案内LPへ差し替え"
              },
              footer: "館内導線、温浴訴求、地域広告をまとめて見せる商談用モック"
            }
          }
        },
        guide: {
          label: "館内案内",
          zones: {
            left: {
              eyebrow: "FLOOR GUIDE",
              headline: "いま行ける館内サービスを見せる。",
              lead: "大浴場、朝食、休憩、ランドリーなど問い合わせが多い情報を入口で提示する。",
              highlight: "大浴場 15:00-翌10:00",
              bullets: ["現在地とフロア案内", "無料サービスを一覧化", "混雑時の問い合わせを削減"],
              visual: "route",
              footer: "館内案内デモ"
            },
            center: {
              eyebrow: "Today's Stay",
              headline: "今日のおすすめ導線",
              lead: "中央画面は滞在体験の提案。時間帯別に朝食、温浴、休憩を切り替える。",
              highlight: "Bath / Lounge / Breakfast",
              stats: [["2F", "大浴場"], ["3F", "ラウンジ"], ["7:00", "朝食"]],
              visual: "hero",
              footer: "時間帯別playlistで館内回遊を作る"
            },
            right: {
              eyebrow: "INFO QR",
              headline: "館内案内を見る",
              lead: "スマホで営業時間、館内図、よくある質問を確認できる。",
              bullets: ["館内マップ", "営業時間", "FAQ"],
              visual: "qr",
              qr: {
                label: "館内案内QRサンプル",
                title: "館内情報",
                url: "https://misell.example/anshin/guide",
                note: "施設別の館内案内ページへ差し替え"
              },
              footer: "Issue #18のQRサンプル"
            }
          }
        },
        sauna: {
          label: "サウナ/休憩訴求",
          zones: {
            left: {
              eyebrow: "SAUNA ROUTINE",
              headline: "滞在中の過ごし方を提案。",
              lead: "サウナ、外気浴、休憩、ドリンクを1つの体験として見せる。",
              highlight: "ととのい導線",
              bullets: ["温浴後の休憩案内", "ドリンク/マッサージ訴求", "混雑時間帯の分散"],
              visual: "timeline",
              footer: "サウナ/休憩訴求デモ"
            },
            center: {
              eyebrow: "Relax Moment",
              headline: "湯上がりラウンジでひと休み",
              lead: "中央は温浴後の体験価値を伝える枠。実写動画に差し替えやすい構成。",
              highlight: "SAUNA + LOUNGE",
              price: "おすすめ 30分",
              stats: [["Bath", "温浴"], ["Drink", "追加注文"], ["Rest", "休憩"]],
              visual: "hero",
              footer: "アップセル導線を右QRへつなげる"
            },
            right: {
              eyebrow: "UPSELL QR",
              headline: "休憩メニューを見る",
              lead: "ドリンク、マッサージ、館内サービスの詳細へ誘導する。",
              bullets: ["湯上がりドリンク", "マッサージ", "休憩スペース"],
              visual: "qr",
              qr: {
                label: "休憩QRサンプル",
                title: "湯上がり案内",
                url: "https://misell.example/anshin/sauna",
                note: "館内サービスLPへ差し替え"
              },
              footer: "滞在単価アップの見せ場"
            }
          }
        },
        localads: {
          label: "近隣広告枠",
          zones: {
            left: {
              eyebrow: "LOCAL MEDIA",
              headline: "宿泊者へ近隣広告を届ける。",
              lead: "飲食、観光、移動、土産など、周辺店舗の広告枠として提案する。",
              highlight: "地域広告枠",
              bullets: ["宿泊者の外出前に接触", "クーポンQRで送客", "広告主別に反応を計測"],
              visual: "sponsor",
              footer: "近隣広告枠例"
            },
            center: {
              eyebrow: "Nearby Pick",
              headline: "今夜の周辺おすすめ",
              lead: "中央は広告主の写真/動画枠。許諾前は架空広告で提案する。",
              highlight: "DINING / TAXI / SOUVENIR",
              chips: ["飲食店", "観光", "交通", "土産"],
              visual: "sponsor",
              footer: "地域メディア化の説明に使う"
            },
            right: {
              eyebrow: "COUPON QR",
              headline: "クーポンを見る",
              lead: "広告主別QRで送客効果を追う。",
              bullets: ["地図", "クーポン", "予約"],
              visual: "qr",
              qr: {
                label: "近隣広告QRサンプル",
                title: "周辺クーポン",
                url: "https://misell.example/anshin/local",
                note: "広告主LPまたはクーポンページへ差し替え"
              },
              footer: "広告主レポートの入口"
            }
          }
        },
        qr: {
          label: "QRサンプル",
          zones: {
            left: {
              eyebrow: "QR MENU",
              headline: "館内QRを用途別に分ける。",
              lead: "案内、予約、広告を別QRにして、何が読まれたかを測る。",
              highlight: "Guide / Service / Coupon",
              bullets: ["館内案内", "サービス予約", "近隣クーポン"],
              visual: "route",
              footer: "QRサンプルデモ"
            },
            center: {
              eyebrow: "Measure",
              headline: "読み取りを月次レポートへ",
              lead: "表示だけで終わらせず、QR別の反応を施設側に報告する。",
              highlight: "QR LOG",
              stats: [["Guide", "案内"], ["Service", "予約"], ["Ads", "広告"]],
              visual: "hero",
              footer: "Issue #18のQR要件を満たす"
            },
            right: {
              eyebrow: "SCAN",
              headline: "館内メニュー",
              lead: "利用者がスマホで詳細を確認できるサンプルQR。",
              bullets: ["大浴場", "朝食", "周辺情報"],
              visual: "qr",
              qr: {
                label: "QRサンプル",
                title: "館内メニュー",
                url: "https://misell.example/anshin/qr",
                note: "QRはテスト導入先URLへ差し替え"
              },
              footer: "商談時のQR動線説明用"
            }
          }
        }
      }
    },
    balian: {
      label: "バリアン",
      theme: "theme-balian",
      descriptor: "ルームサービス・記念日・アメニティ",
      scenes: {
        wide: {
          label: "3面ワイド",
          zones: {
            wide: {
              eyebrow: "BALIAN EXPERIENCE WALL",
              headline: "非日常の滞在を、追加体験につなげる。",
              lead: "客室前、受付、共用部でルームサービス、記念日、アメニティ、予約導線を見せる。",
              highlight: "Room Service / Anniversary / Amenity / Reserve",
              chips: ["ルームサービス", "記念日", "アメニティ", "予約QR"],
              stats: [["4", "訴求テーマ"], ["3", "画面連動"], ["+1", "追加注文"]],
              visual: "wide",
              qr: {
                label: "予約導線QRサンプル",
                title: "次回予約を見る",
                url: "https://misell.example/demo/balian",
                note: "実導入時は予約LPへ差し替え"
              },
              footer: "実在写真やロゴなしで非日常感を伝える商談用モック"
            }
          }
        },
        roomservice: {
          label: "ルームサービス",
          zones: {
            left: {
              eyebrow: "ROOM SERVICE",
              headline: "部屋に入る前に、注文したいものを見せる。",
              lead: "人気メニュー、セット、注文QRを3面で分けて追加注文につなげる。",
              highlight: "人気セット 2,400円",
              bullets: ["客室前で注文を想起", "夜/朝でメニューを切替", "QRで詳細確認"],
              visual: "menu",
              footer: "ルームサービス訴求デモ"
            },
            center: {
              eyebrow: "Main Menu",
              headline: "リゾート気分のルームディナー",
              lead: "中央は料理写真や動画の差し替え枠。まずはコピーと価格で商談可能。",
              highlight: "DINNER SET",
              price: "税込 2,400円",
              stats: [["Food", "料理"], ["Drink", "ドリンク"], ["QR", "注文"]],
              visual: "hero",
              footer: "中央主役型の飲食訴求"
            },
            right: {
              eyebrow: "ORDER QR",
              headline: "客室で注文",
              lead: "ルームサービス詳細、提供時間、注文導線へ案内する。",
              bullets: ["人気メニュー", "提供時間", "追加オプション"],
              visual: "qr",
              qr: {
                label: "注文QRサンプル",
                title: "メニューを見る",
                url: "https://misell.example/balian/roomservice",
                note: "注文ページまたはメニューLPへ差し替え"
              },
              footer: "追加注文のKPIへつなげる"
            }
          }
        },
        anniversary: {
          label: "記念日プラン",
          zones: {
            left: {
              eyebrow: "ANNIVERSARY",
              headline: "今日は特別な日に。",
              lead: "記念日オプション、演出、予約条件を受付前に見せる。",
              highlight: "サプライズ演出",
              bullets: ["ケーキ/花束/装飾", "当日追加の相談導線", "次回予約にも誘導"],
              visual: "timeline",
              footer: "記念日プラン訴求デモ"
            },
            center: {
              eyebrow: "Special Stay",
              headline: "ふたりの記念日に、もうひとつ演出を。",
              lead: "中央は雰囲気を担当。実写やブランド素材へ差し替えやすい構成。",
              highlight: "ANNIVERSARY PLAN",
              chips: ["Cake", "Flower", "Room deco", "Photo"],
              visual: "hero",
              footer: "非日常感を出しつつ許諾素材なしで見せる"
            },
            right: {
              eyebrow: "RESERVE",
              headline: "オプション相談",
              lead: "空き状況、料金、申込締切をQRで案内する。",
              bullets: ["料金", "空き状況", "申込締切"],
              visual: "qr",
              qr: {
                label: "記念日QRサンプル",
                title: "プラン詳細",
                url: "https://misell.example/balian/anniversary",
                note: "予約フォームへ差し替え"
              },
              footer: "記念日オプション利用をKPI化"
            }
          }
        },
        amenity: {
          label: "アメニティ案内",
          zones: {
            left: {
              eyebrow: "AMENITY GUIDE",
              headline: "無料と有料のサービスを分かりやすく。",
              lead: "アメニティ、貸出品、プレミアムサービスを整理して表示する。",
              highlight: "Free / Premium",
              bullets: ["無料サービスを明確化", "有料アップグレードを案内", "問い合わせを削減"],
              visual: "menu",
              footer: "アメニティ案内デモ"
            },
            center: {
              eyebrow: "Comfort Menu",
              headline: "滞在を整えるアメニティ",
              lead: "中央は利用シーンを見せる枠。写真素材が届けばそのまま差し替える。",
              highlight: "AMENITY BAR",
              stats: [["Free", "無料"], ["Plus", "有料"], ["FAQ", "案内"]],
              visual: "hero",
              footer: "スタッフ説明工数の削減を説明"
            },
            right: {
              eyebrow: "INFO QR",
              headline: "詳しく見る",
              lead: "貸出条件、在庫、追加サービスをQRで確認できる。",
              bullets: ["貸出品", "在庫確認", "追加サービス"],
              visual: "qr",
              qr: {
                label: "アメニティQRサンプル",
                title: "サービス一覧",
                url: "https://misell.example/balian/amenity",
                note: "館内サービスLPへ差し替え"
              },
              footer: "滞在満足度向上の見せ場"
            }
          }
        },
        reservation: {
          label: "予約導線QR",
          zones: {
            left: {
              eyebrow: "NEXT VISIT",
              headline: "また来たい瞬間に予約へ。",
              lead: "滞在中に次回予約、記念日プラン、系列施設を案内する。",
              highlight: "次回予約特典",
              bullets: ["会計前に訴求", "記念日利用を提案", "系列施設へ送客"],
              visual: "route",
              footer: "予約導線QRサンプル"
            },
            center: {
              eyebrow: "Reservation Flow",
              headline: "次の滞在を今すぐ確認",
              lead: "中央は次回予約の価値訴求。左右で特典とQRを補う。",
              highlight: "RESERVE AGAIN",
              chips: ["Room", "Anniversary", "Coupon", "Member"],
              visual: "route",
              footer: "再来店導線の提案"
            },
            right: {
              eyebrow: "BOOKING QR",
              headline: "空室を確認",
              lead: "予約ページ、会員登録、クーポンへ誘導する。",
              bullets: ["空室検索", "会員登録", "クーポン"],
              visual: "qr",
              qr: {
                label: "予約QRサンプル",
                title: "次回予約",
                url: "https://misell.example/balian/reserve",
                note: "公式予約ページへ差し替え"
              },
              footer: "Issue #19の予約導線QRサンプル"
            }
          }
        }
      }
    },
    pasela: {
      label: "パセラ",
      theme: "theme-pasela",
      descriptor: "フード・コラボ・イベント",
      scenes: {
        wide: {
          label: "3面ワイド",
          zones: {
            wide: {
              eyebrow: "PASERA MOMENT WALL",
              headline: "個室の外も、回遊メディアに。",
              lead: "来店直後、移動中、会計前におすすめとイベントをまとめて届ける3連サイネージ。",
              highlight: "Food / Collab / Event / QR",
              chips: ["注文QR", "コラボ予約", "系列施設送客", "広告枠"],
              stats: [["4", "訴求テーマ"], ["3", "画面連動"], ["60秒", "商談デモ"]],
              visual: "wide",
              qr: {
                label: "回遊導線サンプル",
                title: "次の体験へ",
                url: "https://misell.example/demo/pasela",
                note: "実導入時は施設別LPへ差し替え"
              },
              footer: "実在ロゴや写真を使わない商談用モック素材"
            }
          }
        },
        food: {
          label: "フード/ドリンク訴求",
          zones: {
            left: {
              eyebrow: "本日の推しメニュー",
              headline: "個室に入る前から注文したくなる。",
              lead: "おすすめセットを入口と通路で先出しし、最初の注文を増やす。",
              highlight: "乾杯セット 1,980円",
              bullets: ["入店直後に見える大きな商品名", "時間帯でランチ/夜メニューを切替", "QR注文とスタッフ案内を同時に表示"],
              chips: ["Food", "Drink", "Order QR"],
              visual: "menu",
              footer: "写真素材が届く前でも商品名と価格で提案可能"
            },
            center: {
              eyebrow: "Main Visual",
              headline: "熱々プレート + 推しドリンク",
              lead: "中央画面は料理の大きな見せ場。動画や写真に差し替える前提のヒーロー枠。",
              highlight: "SET MENU",
              price: "税込 1,980円",
              stats: [["No.1", "宴会前注文"], ["+1品", "ついで注文"], ["QR", "注文導線"]],
              visual: "hero",
              footer: "中央に商品、左右に理由とCTAを置く中央主役型"
            },
            right: {
              eyebrow: "ORDER FLOW",
              headline: "QRでメニュー確認",
              lead: "スマホから詳細を見せ、卓上POPやスタッフ案内へつなげる。",
              bullets: ["限定セット", "ドリンク追加", "コラボ特典対象"],
              visual: "qr",
              qr: {
                label: "注文QRサンプル",
                title: "おすすめを見る",
                url: "https://misell.example/pasela/order",
                note: "実導入時は注文ページまたはメニューLPへ差し替え"
              },
              footer: "QR読み取り数を月次レポートの指標にする"
            }
          }
        },
        collab: {
          label: "コラボ告知",
          zones: {
            left: {
              eyebrow: "COLLAB CAMPAIGN",
              headline: "推し活ルーム、今週スタート。",
              lead: "限定ノベルティ、予約枠、対象メニューを3面で分けて見せる。",
              highlight: "限定特典つき",
              bullets: ["予約前の期待感を作る", "特典条件を左画面で明確化", "混雑時も見落とされにくい"],
              visual: "timeline",
              footer: "版権素材は許諾後に中央ビジュアルへ差し替え"
            },
            center: {
              eyebrow: "Main Collaboration",
              headline: "COLLAB ROOM",
              lead: "中央はキービジュアルの代替枠。色面とコピーだけで商談用の雰囲気を作る。",
              highlight: "推しカラー演出",
              chips: ["Room", "Menu", "Goods", "Photo spot"],
              visual: "hero",
              footer: "実素材が届くまでの仮ビジュアル"
            },
            right: {
              eyebrow: "RESERVE",
              headline: "空き枠を確認",
              lead: "予約、特典詳細、対象店舗をQRで案内する。",
              bullets: ["開催期間", "対象店舗", "特典条件"],
              visual: "qr",
              qr: {
                label: "予約QRサンプル",
                title: "コラボ詳細",
                url: "https://misell.example/pasela/collab",
                note: "外部予約ページまたはキャンペーンLPへ接続"
              },
              footer: "特典条件の問い合わせ削減を狙う"
            }
          }
        },
        event: {
          label: "イベント案内",
          zones: {
            left: {
              eyebrow: "TODAY'S EVENT",
              headline: "本日のイベントを入口で把握。",
              lead: "ライブビューイング、貸切、季節企画をタイムテーブルで見せる。",
              highlight: "19:00 START",
              bullets: ["開始前の滞留時間に訴求", "次回イベントの予約へ誘導", "館内スタッフの説明を補助"],
              visual: "timeline",
              footer: "時間帯別playlistと相性がよい"
            },
            center: {
              eyebrow: "Live Viewing",
              headline: "大画面で集まる夜",
              lead: "中央画面はイベントの臨場感を担当。動画素材がある場合はここに配置する。",
              highlight: "EVENT NIGHT",
              stats: [["19:00", "開場"], ["20:00", "開始"], ["After", "追加注文"]],
              visual: "hero",
              footer: "イベント前後のフード/ドリンク訴求へつなげる"
            },
            right: {
              eyebrow: "JOIN",
              headline: "参加予約はこちら",
              lead: "参加条件、会場、注意事項をQRで確認できる。",
              bullets: ["予約ページ", "会場マップ", "次回告知"],
              visual: "qr",
              qr: {
                label: "イベントQRサンプル",
                title: "イベント詳細",
                url: "https://misell.example/pasela/event",
                note: "当日イベントLPへ差し替え"
              },
              footer: "QRと予約数をイベント別に追う"
            }
          }
        },
        tour: {
          label: "回遊導線QR",
          zones: {
            left: {
              eyebrow: "GROUP TOUR",
              headline: "次に行きたい場所を見せる。",
              lead: "系列施設、近隣店舗、イベント会場への送客を通路で作る。",
              highlight: "施設横断マップ",
              bullets: ["カラオケ後の二次利用", "近隣施設への送客", "広告枠として販売可能"],
              visual: "route",
              footer: "グループ内回遊の提案材料"
            },
            center: {
              eyebrow: "Route Media",
              headline: "店内導線を広告枠に変える",
              lead: "中央は回遊先の魅力、左は候補、右はQRという構成。",
              highlight: "NEXT EXPERIENCE",
              chips: ["Dining", "Event", "Hotel", "Shop"],
              visual: "route",
              footer: "広告主候補を増やす見せ方"
            },
            right: {
              eyebrow: "QR SAMPLE",
              headline: "回遊先を選ぶ",
              lead: "3つのQRを並べ、行き先別に反応を計測する。",
              bullets: ["系列施設A", "系列施設B", "イベント予約"],
              visual: "qr",
              qr: {
                label: "回遊QRサンプル",
                title: "周辺おすすめ",
                url: "https://misell.example/pasela/tour",
                note: "実導入時は施設別の回遊LPへ差し替え"
              },
              footer: "Issue #20の回遊導線QRサンプル"
            }
          }
        }
      }
    },
    "vision-center": {
      label: "ビジョンセンター",
      theme: "theme-vision-center",
      descriptor: "会場案内・配信・スポンサー",
      scenes: {
        wide: {
          label: "3面ワイド",
          zones: {
            wide: {
              eyebrow: "VISION CENTER MEDIA",
              headline: "会場案内を、当日の収益メディアへ。",
              lead: "受付、会場誘導、配信パック、スポンサー枠を1つのサイネージ体験にまとめる。",
              highlight: "Guide / Streaming / Sponsor / Reception",
              chips: ["受付案内", "会場MAP", "配信相談", "協賛枠"],
              stats: [["4", "訴求テーマ"], ["3", "画面連動"], ["1分", "提案デモ"]],
              visual: "wide",
              qr: {
                label: "会場LPサンプル",
                title: "当日案内を見る",
                url: "https://misell.example/demo/vision-center",
                note: "イベント別案内ページへ差し替え"
              },
              footer: "会場名、部屋名、スポンサーは導入時に差し替え"
            }
          }
        },
        guide: {
          label: "会場案内",
          zones: {
            left: {
              eyebrow: "TODAY'S ROOMS",
              headline: "会場と時刻を一目で確認。",
              lead: "来場者が受付前に迷わないよう、部屋名と開催時間を大きく表示する。",
              highlight: "Aホール 10:00-17:00",
              bullets: ["会場一覧", "現在開催中", "次のイベント"],
              visual: "timeline",
              footer: "受付問い合わせ削減の見せ場"
            },
            center: {
              eyebrow: "Now Live",
              headline: "DXカンファレンス 2026",
              lead: "中央画面に現在開催中のイベントを置き、左右で導線を補足する。",
              highlight: "KEYNOTE 13:00",
              stats: [["A", "ホール"], ["3F", "フロア"], ["13:00", "次セッション"]],
              visual: "hero",
              footer: "実イベント名に差し替えるだけで商談デモ化"
            },
            right: {
              eyebrow: "MAP QR",
              headline: "会場マップを見る",
              lead: "フロア図、トイレ、喫煙所、Wi-Fi情報へ誘導する。",
              bullets: ["フロア案内", "Wi-Fi", "問い合わせ"],
              visual: "qr",
              qr: {
                label: "会場案内QRサンプル",
                title: "フロアMAP",
                url: "https://misell.example/vision/map",
                note: "会場別の案内ページへ差し替え"
              },
              footer: "Issue #21の会場案内素材"
            }
          }
        },
        streaming: {
          label: "配信パック訴求",
          zones: {
            left: {
              eyebrow: "STREAMING PAIN",
              headline: "配信準備の不安を会場で拾う。",
              lead: "音声、録画、ハイブリッド配信の不安を左画面で言語化する。",
              highlight: "配信担当が足りない",
              bullets: ["音声トラブルが怖い", "録画データを残したい", "オンライン参加者も増やしたい"],
              visual: "reception",
              footer: "商談時は追加売上の入口として説明"
            },
            center: {
              eyebrow: "Streaming Pack",
              headline: "会場 + 配信をワンストップで",
              lead: "中央にサービス価値を出し、右の相談QRへつなげる。",
              highlight: "配信パック",
              price: "相談受付中",
              stats: [["CAM", "カメラ"], ["MIC", "音声"], ["REC", "収録"]],
              visual: "hero",
              footer: "施設側のアップセル提案"
            },
            right: {
              eyebrow: "CONSULT",
              headline: "配信相談はこちら",
              lead: "必要機材、料金、空き状況をQRで確認できる。",
              bullets: ["見積依頼", "機材一覧", "事例を見る"],
              visual: "qr",
              qr: {
                label: "相談QRサンプル",
                title: "配信パック相談",
                url: "https://misell.example/vision/streaming",
                note: "問い合わせフォームへ差し替え"
              },
              footer: "配信パック問い合わせをKPI化"
            }
          }
        },
        sponsor: {
          label: "スポンサー枠例",
          zones: {
            left: {
              eyebrow: "SPONSOR SLOT",
              headline: "来場者に届く協賛枠。",
              lead: "イベント名、協賛企業、資料請求QRを分けて見せる。",
              highlight: "Event Partner",
              bullets: ["受付前で接触", "休憩中に再表示", "QRで資料請求を計測"],
              visual: "sponsor",
              footer: "会場メディア化の収益モデルを見せる"
            },
            center: {
              eyebrow: "Sponsor Creative",
              headline: "スポンサー広告サンプル",
              lead: "中央は広告主クリエイティブ枠。ロゴ許諾前は架空ブランドで提案する。",
              highlight: "B2B SOLUTION DAY",
              chips: ["Booth", "Document", "Trial", "Seminar"],
              visual: "sponsor",
              footer: "実導入時は広告審査フローを通す"
            },
            right: {
              eyebrow: "LEAD",
              headline: "資料請求QR",
              lead: "広告主ごとにQRを分け、読み取り数をレポート化する。",
              bullets: ["協賛資料", "ブース案内", "商談予約"],
              visual: "qr",
              qr: {
                label: "スポンサーQRサンプル",
                title: "資料請求",
                url: "https://misell.example/vision/sponsor",
                note: "広告主LPまたは資料請求フォームへ差し替え"
              },
              footer: "スポンサー枠販売の見本"
            }
          }
        },
        reception: {
          label: "受付案内",
          zones: {
            left: {
              eyebrow: "CHECK-IN FLOW",
              headline: "受付前の迷いを減らす。",
              lead: "参加証、名刺、本人確認など、受付前に必要な準備を表示する。",
              highlight: "Step 1: QR準備",
              steps: ["参加QRを表示", "受付列へ進む", "名札を受け取る"],
              visual: "reception",
              footer: "混雑時間帯だけ強制表示する想定"
            },
            center: {
              eyebrow: "Reception Guide",
              headline: "受付は右手カウンターへ",
              lead: "中央に一番重要な行動を置き、左右で詳細とQRを補う。",
              highlight: "3F 受付",
              chips: ["Check-in", "Name card", "Wi-Fi", "Map"],
              visual: "route",
              footer: "イベントごとの案内文に差し替え可能"
            },
            right: {
              eyebrow: "HELP QR",
              headline: "受付案内を見る",
              lead: "参加者向けFAQ、Wi-Fi、フロアマップに誘導する。",
              bullets: ["受付FAQ", "Wi-Fi", "会場MAP"],
              visual: "qr",
              qr: {
                label: "受付QRサンプル",
                title: "チェックイン案内",
                url: "https://misell.example/vision/reception",
                note: "イベント受付ページへ差し替え"
              },
              footer: "Issue #21の受付案内素材"
            }
          }
        }
      }
    }
  };

  const root = document.getElementById("industry-demo");
  const params = new URLSearchParams(window.location.search);
  const industryId = normalizeId(params.get("industry"), DEFAULT_INDUSTRY);
  const sceneId = normalizeId(params.get("scene"), DEFAULT_SCENE);
  const zoneId = normalizeId(params.get("zone"), DEFAULT_ZONE);
  const industry = DEMOS[industryId] || DEMOS[DEFAULT_INDUSTRY];
  const scene = industry.scenes[sceneId] || industry.scenes[DEFAULT_SCENE] || Object.values(industry.scenes)[0];
  const zone = scene.zones[zoneId] || scene.zones[DEFAULT_ZONE] || Object.values(scene.zones)[0];

  document.title = `${industry.label} ${scene.label} ${zoneId} - Misell demo`;
  document.body.className = `${industry.theme} zone-${zoneId} scene-${sceneId}`;
  render();

  function normalizeId(value, fallback) {
    return String(value || fallback).trim().toLowerCase();
  }

  function render() {
    root.replaceChildren();
    root.appendChild(renderCopyPanel());
    if (!zone.qr || zoneId === "wide") {
      root.appendChild(renderVisualPanel());
    }
    if (zone.qr || zoneId === "wide") {
      root.appendChild(renderQrPanel(zone.qr || fallbackQr()));
    }
  }

  function renderCopyPanel() {
    const panel = element("section", "copy-panel");
    panel.appendChild(renderTopline());
    appendText(panel, "p", "eyebrow", zone.eyebrow);
    appendText(panel, "h1", "", zone.headline);
    appendText(panel, "p", "lead", zone.lead);
    appendText(panel, "div", "highlight", zone.highlight);
    appendText(panel, "div", "price", zone.price);
    if (zone.bullets) panel.appendChild(renderList(zone.bullets, "bullet-list", "ul"));
    if (zone.steps) panel.appendChild(renderList(zone.steps, "step-list", "ol"));
    if (zone.chips) panel.appendChild(renderChips(zone.chips));
    if (zone.stats) panel.appendChild(renderStats(zone.stats));
    appendText(panel, "p", "footer-note", zone.footer);
    return panel;
  }

  function renderTopline() {
    const wrapper = element("div", "demo-topline");
    appendText(wrapper, "span", "demo-badge", industry.label);
    appendText(wrapper, "span", "", scene.label);
    appendText(wrapper, "span", "", zoneId.toUpperCase());
    appendText(wrapper, "span", "", industry.descriptor);
    return wrapper;
  }

  function renderVisualPanel() {
    const kind = zone.visual || "hero";
    const panel = element("aside", `visual-panel visual-${kind}`);
    appendText(panel, "p", "visual-title", visualTitle(kind));
    if (kind === "menu") renderRows(panel, "menu-board", "menu-row", zone.bullets || zone.chips || []);
    else if (kind === "timeline") renderRows(panel, "timeline-board", "timeline-row", timelineRows());
    else if (kind === "route") renderRows(panel, "route-board", "route-node", routeRows());
    else if (kind === "sponsor") renderRows(panel, "sponsor-board", "sponsor-slot", sponsorRows());
    else if (kind === "reception") renderRows(panel, "reception-board", "reception-step", zone.steps || zone.bullets || []);
    else if (kind === "wide") renderRows(panel, "wide-board", "wide-line", zone.chips || []);
    else renderHero(panel);
    return panel;
  }

  function renderRows(panel, boardClass, rowClass, rows) {
    const board = element("div", boardClass);
    rows.slice(0, 4).forEach((row, index) => {
      const label = Array.isArray(row) ? row[0] : row;
      const detail = Array.isArray(row) ? row[1] : visualDetail(index);
      const item = element("div", rowClass);
      appendText(item, "strong", "", label);
      appendText(item, "span", "", detail);
      board.appendChild(item);
    });
    panel.appendChild(board);
  }

  function renderHero(panel) {
    const board = element("div", "hero-board");
    appendText(board, "div", "hero-mark", zone.highlight || scene.label);
    const rows = zone.stats ? zone.stats.map(([value, label]) => [value, label]) : [[scene.label, industry.label], ["3面連動", "Misell"], ["QR導線", "Measure"]];
    renderRows(board, "hero-lines", "hero-line", rows);
    panel.appendChild(board);
  }

  function renderQrPanel(qr) {
    const panel = element("aside", "qr-panel");
    appendText(panel, "p", "qr-label", qr.label);
    appendText(panel, "h2", "qr-title", qr.title);
    panel.appendChild(createQrMatrix(qr.url));
    appendText(panel, "p", "qr-url", qr.url);
    appendText(panel, "p", "qr-note", qr.note);
    return panel;
  }

  function renderList(items, className, tagName) {
    const list = element(tagName, className);
    items.forEach((item) => appendText(list, "li", "", item));
    return list;
  }

  function renderChips(items) {
    const row = element("div", "chip-row");
    items.forEach((item) => appendText(row, "span", "", item));
    return row;
  }

  function renderStats(items) {
    const strip = element("div", "stat-strip");
    items.forEach(([value, label]) => {
      const item = element("div");
      appendText(item, "strong", "", value);
      appendText(item, "span", "", label);
      strip.appendChild(item);
    });
    return strip;
  }

  function createQrMatrix(text) {
    const size = 29;
    const seed = hashText(text);
    const matrix = element("div", "qr-matrix");
    matrix.setAttribute("role", "img");
    matrix.setAttribute("aria-label", `QR sample for ${text}`);

    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const cell = element("span");
        if (isQrCellOn(row, column, size, seed)) cell.className = "on";
        matrix.appendChild(cell);
      }
    }
    return matrix;
  }

  function isQrCellOn(row, column, size, seed) {
    const finder = finderValue(row, column, 0, 0)
      ?? finderValue(row, column, 0, size - 7)
      ?? finderValue(row, column, size - 7, 0);
    if (finder !== null) return finder;
    const value = Math.imul(seed ^ Math.imul(row + 11, 374761393), column + 17) >>> 0;
    return value % 9 < 4 || (row + column + seed) % 17 === 0;
  }

  function finderValue(row, column, top, left) {
    if (row < top || row >= top + 7 || column < left || column >= left + 7) return null;
    const localRow = row - top;
    const localColumn = column - left;
    const border = localRow === 0 || localRow === 6 || localColumn === 0 || localColumn === 6;
    const center = localRow >= 2 && localRow <= 4 && localColumn >= 2 && localColumn <= 4;
    return border || center;
  }

  function hashText(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function timelineRows() {
    return [["10:00", "受付/開場"], ["13:00", "メイン枠"], ["19:00", "夜イベント"], ["After", "予約/注文へ誘導"]];
  }

  function routeRows() {
    return [["Entrance", "入口で認知"], ["Screen", "通路で比較"], ["QR", "スマホで詳細"], ["Next", "予約/注文/送客"]];
  }

  function sponsorRows() {
    return [["Sponsor A", "受付前大型枠"], ["Sponsor B", "休憩中リマインド"], ["Lead QR", "資料請求を計測"]];
  }

  function visualDetail(index) {
    return ["大きく見せる", "行動へつなげる", "計測できる", "差し替えやすい"][index] || "Misell demo";
  }

  function visualTitle(kind) {
    return {
      menu: "Menu board",
      timeline: "Timeline",
      route: "Route flow",
      sponsor: "Sponsor media",
      reception: "Reception steps",
      wide: "Wide screen map",
      hero: "Main visual"
    }[kind] || "Demo visual";
  }

  function fallbackQr() {
    return {
      label: "Demo QR",
      title: "詳細を見る",
      url: `https://misell.example/demo/${industry.label}`,
      note: "実導入時に差し替え"
    };
  }

  function appendText(parent, tagName, className, text) {
    if (!text) return null;
    const node = element(tagName, className);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function element(tagName, className = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    return node;
  }
}());
