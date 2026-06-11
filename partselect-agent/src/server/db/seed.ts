import { getDb, initSchema } from "./connection";

type ModelRow = [string, string, "refrigerator" | "dishwasher", string];
// model_no, brand, type, display name
const models: ModelRow[] = [
  ["WDT780SAEM1", "Whirlpool", "dishwasher", "Whirlpool 内置式洗碗机 (不锈钢)"],
  ["WDT730PAHZ0", "Whirlpool", "dishwasher", "Whirlpool 静音洗碗机"],
  ["WDF520PADM7", "Whirlpool", "dishwasher", "Whirlpool 前控式洗碗机"],
  ["KDTM354DSS4", "KitchenAid", "dishwasher", "KitchenAid 顶控洗碗机"],
  ["FFCD2413US", "Frigidaire", "dishwasher", "Frigidaire 24寸 洗碗机"],
  ["SHPM65Z55N", "Bosch", "dishwasher", "Bosch 500 系列洗碗机"],
  ["WRS325SDHZ01", "Whirlpool", "refrigerator", "Whirlpool 对开门冰箱 36寸"],
  ["WRS325FDAM04", "Whirlpool", "refrigerator", "Whirlpool 对开门冰箱"],
  ["WRF555SDFZ09", "Whirlpool", "refrigerator", "Whirlpool 法式门冰箱"],
  ["ED5VHEXVB01", "Whirlpool", "refrigerator", "Whirlpool 对开门冰箱 (经典款)"],
  ["GSS25GSHSS", "GE", "refrigerator", "GE 对开门冰箱 25 cu.ft"],
  ["RF28R7351SR", "Samsung", "refrigerator", "Samsung 法式门冰箱"],
];

type PartRow = {
  part_no: string;
  mfr: string;
  name: string;
  desc: string;
  type: "refrigerator" | "dishwasher";
  brand: string;
  price: number;
  stock: number;
  symptoms: string;
  fits: string[]; // model_no list
};

const parts: PartRow[] = [
  // ── 冰箱零件 ──────────────────────────────────────────────
  {
    part_no: "PS11752778", mfr: "WPW10321304",
    name: "冰箱门搁架盒 (Door Shelf Bin)",
    desc: "透明门搁架盒,带白色边框,安装在冰箱门内侧,用于存放调料瓶等。原厂 Whirlpool 配件。",
    type: "refrigerator", brand: "Whirlpool", price: 36.18, stock: 24,
    symptoms: "搁架盒开裂,搁架盒脱落,门内储物盒损坏",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11770704", mfr: "W10882923",
    name: "制冰机总成 (Ice Maker Assembly)",
    desc: "整体式制冰机模块,含电机与控制臂。制冰机完全不出冰且供水正常时通常需要更换本件。",
    type: "refrigerator", brand: "Whirlpool", price: 128.95, stock: 7,
    symptoms: "制冰机不工作,不出冰,制冰量小",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11749909", mfr: "WPW10408179",
    name: "进水电磁阀 (Water Inlet Valve)",
    desc: "双线圈进水阀,控制制冰机与饮水机供水。制冰机不进水、饮水机不出水的首要排查件。",
    type: "refrigerator", brand: "Whirlpool", price: 42.5, stock: 15,
    symptoms: "制冰机不工作,制冰机不进水,饮水机不出水,漏水",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS9493452", mfr: "EDR1RXD1",
    name: "冰箱滤水器 Filter 1 (Water Filter)",
    desc: "原厂滤水器,建议每 6 个月更换。滤芯堵塞会导致制冰变慢、冰块变小或带异味。",
    type: "refrigerator", brand: "Whirlpool", price: 54.99, stock: 48,
    symptoms: "冰块小,制冰慢,水有异味,制冰机不工作",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09"],
  },
  {
    part_no: "PS11749598", mfr: "WPW10189703",
    name: "蒸发器风扇电机 (Evaporator Fan Motor)",
    desc: "将冷气从冷冻室循环到冷藏室。损坏时冰箱不制冷且冷冻室有异响。",
    type: "refrigerator", brand: "Whirlpool", price: 89.95, stock: 9,
    symptoms: "冰箱不制冷,冷冻室异响,嗡嗡声",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11739232", mfr: "WPW10225581",
    name: "除霜双金属温控器 (Defrost Thermostat)",
    desc: "除霜系统核心传感器,故障时蒸发器结霜导致风道堵塞、制冷变差。",
    type: "refrigerator", brand: "Whirlpool", price: 24.1, stock: 21,
    symptoms: "冰箱不制冷,蒸发器结霜,后壁结冰",
    fits: ["WRS325SDHZ01", "ED5VHEXVB01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11740365", mfr: "WPW10583800",
    name: "温度控制器 (Temperature Control Thermostat)",
    desc: "冷藏室温控器,控制压缩机启停。",
    type: "refrigerator", brand: "Whirlpool", price: 95.2, stock: 3,
    symptoms: "冰箱不制冷,温度不稳定,压缩机不启动",
    fits: ["ED5VHEXVB01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11741245", mfr: "WPW10613606",
    name: "压缩机启动继电器 (Start Relay)",
    desc: "压缩机启动装置,故障时冰箱完全不制冷并发出咔哒声。",
    type: "refrigerator", brand: "Whirlpool", price: 33.4, stock: 18,
    symptoms: "冰箱不制冷,咔哒声,压缩机不启动",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11754026", mfr: "WPW10321358",
    name: "保鲜抽屉 (Crisper Drawer)",
    desc: "蔬果保鲜抽屉,透明材质。",
    type: "refrigerator", brand: "Whirlpool", price: 64.95, stock: 0, // 零库存演示
    symptoms: "抽屉开裂,抽屉滑轨损坏",
    fits: ["WRS325SDHZ01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11756250", mfr: "W10822635",
    name: "冷凝器风扇电机 (Condenser Fan Motor)",
    desc: "为冷凝器散热,故障时压缩机过热、冰箱间歇性停机。",
    type: "refrigerator", brand: "Whirlpool", price: 76.4, stock: 11,
    symptoms: "冰箱不制冷,压缩机过热,运行噪音大",
    fits: ["WRS325SDHZ01", "WRF555SDFZ09"],
  },
  {
    part_no: "PS12364199", mfr: "W11043011",
    name: "门封条 (Door Gasket)",
    desc: "磁性门封条,密封不严会导致结霜与耗电增加。",
    type: "refrigerator", brand: "Whirlpool", price: 78.3, stock: 6,
    symptoms: "门关不严,结霜,漏冷气",
    fits: ["WRF555SDFZ09", "WRS325SDHZ01"],
  },
  {
    part_no: "PS16555101", mfr: "WR60X10185",
    name: "GE 蒸发器风扇电机",
    desc: "GE 对开门冰箱冷气循环风扇。",
    type: "refrigerator", brand: "GE", price: 84.6, stock: 8,
    symptoms: "冰箱不制冷,冷冻室异响",
    fits: ["GSS25GSHSS"],
  },
  {
    part_no: "PS12172990", mfr: "DA97-12540G",
    name: "Samsung 制冰机总成",
    desc: "Samsung 法式门冰箱制冰机模块。",
    type: "refrigerator", brand: "Samsung", price: 156.8, stock: 5,
    symptoms: "制冰机不工作,不出冰,制冰机结冰",
    fits: ["RF28R7351SR"],
  },

  // ── 洗碗机零件 ────────────────────────────────────────────
  {
    part_no: "PS10065979", mfr: "W10712395",
    name: "上碗架调节器套件 (Rack Adjuster Kit)",
    desc: "上碗架高度调节器全套(左右各一),含轮架与卡扣。碗架下垂、无法卡住高度时更换。",
    type: "dishwasher", brand: "Whirlpool", price: 39.95, stock: 32,
    symptoms: "上碗架下垂,碗架调节失灵,碗架脱轨",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "KDTM354DSS4"],
  },
  {
    part_no: "PS11722152", mfr: "W10195416",
    name: "下碗架滚轮 (Lower Dishrack Wheel)",
    desc: "下碗架滚轮总成,单只装,卡扣式安装无需工具。",
    type: "dishwasher", brand: "Whirlpool", price: 11.95, stock: 56,
    symptoms: "碗架拉不动,滚轮脱落,滚轮破损",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7", "KDTM354DSS4"],
  },
  {
    part_no: "PS11756710", mfr: "W10518394",
    name: "加热元件 (Heating Element)",
    desc: "底部环形加热管,负责烘干与加热洗涤水。餐具洗后不干的最常见原因。",
    type: "dishwasher", brand: "Whirlpool", price: 48.75, stock: 13,
    symptoms: "餐具不干,烘干效果差,水温不够",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11757304", mfr: "W10348269",
    name: "排水泵 (Drain Pump)",
    desc: "洗碗机排水泵电机,堵转或线圈烧毁时机内积水无法排出。",
    type: "dishwasher", brand: "Whirlpool", price: 86.2, stock: 4, // 低库存演示
    symptoms: "洗碗机不排水,底部积水,排水异响",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11748381", mfr: "W10510667",
    name: "循环泵电机总成 (Wash Pump Motor)",
    desc: "主洗涤循环泵,故障时喷臂无水压、餐具洗不干净。",
    type: "dishwasher", brand: "Whirlpool", price: 142.0, stock: 6,
    symptoms: "洗不干净,喷臂不转,无水压,运行噪音大",
    fits: ["WDT780SAEM1", "WDT730PAHZ0"],
  },
  {
    part_no: "PS11753379", mfr: "W10619006",
    name: "门锁总成 (Door Latch Assembly)",
    desc: "门锁与微动开关总成,门锁不到位时洗碗机无法启动。",
    type: "dishwasher", brand: "Whirlpool", price: 38.6, stock: 17,
    symptoms: "无法启动,门关不严,门锁异响",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS11722102", mfr: "W10491331",
    name: "下喷臂 (Lower Spray Arm)",
    desc: "下层旋转喷臂,喷孔堵塞或断裂会导致下层餐具洗不干净。",
    type: "dishwasher", brand: "Whirlpool", price: 27.85, stock: 25,
    symptoms: "洗不干净,喷臂不转,喷臂破损",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11750084", mfr: "W10350376",
    name: "洗涤剂分配器 (Detergent Dispenser)",
    desc: "洗涤剂与漂洗剂分配器总成,盖板不弹开时洗涤剂无法投放。",
    type: "dishwasher", brand: "Whirlpool", price: 58.4, stock: 0, // 零库存演示
    symptoms: "洗涤剂不投放,分配器盖不弹开,漂洗剂泄漏",
    fits: ["WDT780SAEM1", "WDT730PAHZ0"],
  },
  {
    part_no: "PS11745312", mfr: "W10195039",
    name: "浮子开关 (Float Switch)",
    desc: "防溢水浮子开关,误触发时洗碗机不进水。",
    type: "dishwasher", brand: "Whirlpool", price: 19.95, stock: 29,
    symptoms: "不进水,进水后立即停止,溢水",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS11750093", mfr: "W10872255",
    name: "洗碗机进水阀 (Water Inlet Valve)",
    desc: "进水电磁阀,故障时不进水或进水不止。",
    type: "dishwasher", brand: "Whirlpool", price: 46.3, stock: 14,
    symptoms: "不进水,进水缓慢,关机后仍进水,漏水",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11770146", mfr: "W11035180",
    name: "电子控制板 (Electronic Control Board)",
    desc: "主控板,按键无响应、程序紊乱时更换。",
    type: "dishwasher", brand: "Whirlpool", price: 164.5, stock: 2, // 低库存演示
    symptoms: "无法启动,按键无响应,程序紊乱,指示灯乱闪",
    fits: ["WDT780SAEM1"],
  },
  {
    part_no: "PS11769110", mfr: "W10300924",
    name: "门封条 (Door Seal/Gasket)",
    desc: "门体四周密封胶条,老化后门缝漏水。",
    type: "dishwasher", brand: "Whirlpool", price: 34.2, stock: 22,
    symptoms: "门缝漏水,密封条老化,异味",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11746591", mfr: "WPW10082853",
    name: "餐具篮 (Silverware Basket)",
    desc: "门挂式餐具篮,分格带盖。",
    type: "dishwasher", brand: "Whirlpool", price: 32.95, stock: 19,
    symptoms: "餐具篮破损,格栅断裂",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS12348510", mfr: "5304506523",
    name: "Frigidaire 喷臂套件",
    desc: "Frigidaire 洗碗机上下喷臂套件。",
    type: "dishwasher", brand: "Frigidaire", price: 41.7, stock: 10,
    symptoms: "洗不干净,喷臂不转",
    fits: ["FFCD2413US"],
  },
  {
    part_no: "PS16219067", mfr: "00754866",
    name: "Bosch 排水泵",
    desc: "Bosch 500 系列洗碗机排水泵。",
    type: "dishwasher", brand: "Bosch", price: 92.3, stock: 7,
    symptoms: "不排水,底部积水,E24 报错",
    fits: ["SHPM65Z55N"],
  },
];

type GuideRow = {
  part_no: string;
  difficulty: "easy" | "medium" | "hard";
  minutes: number;
  tools: string;
  steps: string[];
  video?: string;
  manual?: string;
};

const guides: GuideRow[] = [
  {
    part_no: "PS11752778", difficulty: "easy", minutes: 1, tools: "无需工具",
    steps: [
      "打开冰箱门,清空搁架盒内的物品",
      "双手握住搁架盒两侧,垂直向上提起,使其脱离门内胆卡槽",
      "将新搁架盒对准门内胆两侧卡槽",
      "垂直向下按压,听到卡入声即安装完成",
    ],
    video: "https://www.youtube.com/watch?v=ps11752778-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11752778/",
  },
  {
    part_no: "PS10065979", difficulty: "medium", minutes: 30, tools: "十字螺丝刀",
    steps: [
      "拉出上碗架,找到两侧滑轨末端的限位卡扣并按压取下",
      "将上碗架整体从滑轨中抽出,放到台面上",
      "拆下旧调节器:按住释放钮并滑出",
      "将新调节器套件装入碗架两侧,确认卡扣到位",
      "把碗架推回滑轨,装回限位卡扣,测试升降功能",
    ],
    video: "https://www.youtube.com/watch?v=ps10065979-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS10065979/",
  },
  {
    part_no: "PS11756710", difficulty: "medium", minutes: 45, tools: "十字螺丝刀, 套筒扳手, 万用表",
    steps: [
      "断开洗碗机电源(拔插头或关断路器)",
      "拆下底部踢脚板,找到加热元件两端接线端子",
      "拍照记录接线位置后拔下端子",
      "在机内拧下加热元件固定螺母",
      "从机内取出旧加热元件,装入新元件并对准安装孔",
      "拧紧固定螺母,接回端子,恢复供电并运行烘干测试",
    ],
    video: "https://www.youtube.com/watch?v=ps11756710-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11756710/",
  },
  {
    part_no: "PS11757304", difficulty: "medium", minutes: 40, tools: "十字螺丝刀, 平口钳, 毛巾",
    steps: [
      "断电断水,垫好毛巾防止余水流出",
      "拆下踢脚板,找到位于底盘的排水泵",
      "拔下泵体电源插头,松开排水管卡箍",
      "逆时针旋转排水泵将其从集水槽上取下",
      "装上新泵顺时针锁紧,接回水管与插头",
      "恢复供电,运行排水程序检查是否漏水",
    ],
    video: "https://www.youtube.com/watch?v=ps11757304-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11757304/",
  },
  {
    part_no: "PS11770704", difficulty: "medium", minutes: 25, tools: "十字螺丝刀, 5/16 套筒",
    steps: [
      "断开冰箱电源,取出冷冻室内的冰桶",
      "拧下制冰机底部两颗固定螺丝,托住机体向上抬起脱钩",
      "拔下背面线束插头,取出旧制冰机",
      "插好新制冰机线束,挂回卡钩并拧紧螺丝",
      "恢复供电,等待 24 小时观察制冰是否正常",
    ],
    video: "https://www.youtube.com/watch?v=ps11770704-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11770704/",
  },
  {
    part_no: "PS11749909", difficulty: "medium", minutes: 35, tools: "十字螺丝刀, 1/4 套筒, 活动扳手",
    steps: [
      "断电,关闭冰箱后方供水阀",
      "拉出冰箱,拆下背部下方检修板",
      "用扳手松开进水阀上的水管压接螺母",
      "拔下电磁阀线束,拧下阀体固定螺丝",
      "装上新阀,接回水管(注意不要过度拧紧)与线束",
      "开水检查接口渗漏,恢复供电",
    ],
    video: "https://www.youtube.com/watch?v=ps11749909-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11749909/",
  },
  {
    part_no: "PS11722152", difficulty: "easy", minutes: 2, tools: "无需工具",
    steps: [
      "拉出下碗架",
      "按压旧滚轮中心卡扣,将其从轮轴上拔下",
      "把新滚轮对准轮轴推入,听到咔哒声即到位",
    ],
    manual: "https://www.partselect.com/Installation-Instructions/PS11722152/",
  },
  {
    part_no: "PS9493452", difficulty: "easy", minutes: 2, tools: "无需工具",
    steps: [
      "找到冷藏室右上角(或底部格栅)的滤芯仓",
      "逆时针旋转旧滤芯 1/4 圈并拔出",
      "撕掉新滤芯保护盖,插入并顺时针旋转锁定",
      "放水 4 升冲洗滤芯后正常使用",
    ],
    manual: "https://www.partselect.com/Installation-Instructions/PS9493452/",
  },
];

type ChunkRow = {
  source_type: "repair_guide" | "manual" | "transcript";
  part_no?: string;
  appliance_type: "refrigerator" | "dishwasher";
  symptom_tags: string;
  text: string;
  source_url?: string;
  source_ref?: string;
};

const chunks: ChunkRow[] = [
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "制冰机不工作,不出冰",
    text:
      "惠而浦冰箱制冰机不工作的排查顺序:1) 确认制冰机控制臂/开关处于开启位置;2) 确认冷冻室温度低于 -12°C(0°F 至 5°F 最佳),温度过高制冰机不会启动;3) 检查滤水器是否超过 6 个月未更换,堵塞的滤芯会显著降低供水量;4) 听进水阀是否有充水声,无充水声且水压正常(>137kPa)则进水电磁阀(WPW10408179)可能损坏;5) 以上正常但仍不出冰,通常为制冰机总成(W10882923)内部电机或温控失效,建议整体更换。",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Ice-Maker-Not-Making-Ice/",
  },
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "制冰机不工作,冰块小,制冰慢",
    text:
      "制冰量小或冰块发空的常见原因是供水不足:优先更换滤水器(EDR1RXD1),其次检查家中水压;若冰箱接软管供水且水压不足,制冰机每次注水量不够会产生小冰块。进水阀部分堵塞也会导致同样症状。",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Small-Ice-Cubes/",
  },
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "冰箱不制冷,冷藏室不冷",
    text:
      "冰箱不制冷排查:1) 清洁冷凝器线圈(底部格栅后方),灰尘堆积是头号原因;2) 确认冷凝器风扇运转正常;3) 冷冻室正常但冷藏室不冷,多为蒸发器风扇电机(WPW10189703)故障或风道被霜堵塞;4) 后壁大面积结冰说明除霜系统故障,优先检查除霜温控器(WPW10225581);5) 压缩机有咔哒声但不启动,更换启动继电器(WPW10613606)。",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Not-Cooling/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "不排水,底部积水",
    text:
      "洗碗机不排水排查:1) 清理机内底部过滤器的食物残渣;2) 检查排水管是否打折,新装机需确认水槽下排水高环(high loop);3) 若接厨余粉碎机,确认排水口的堵头(knockout plug)已敲除;4) 运行排水程序听泵声:无声音或只有嗡嗡声,排水泵(W10348269)堵转或烧毁,需要更换;Bosch 机型显示 E24/E25 报错同理。",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Draining/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "餐具不干,烘干效果差",
    text:
      "餐具洗后不干:1) 确认漂洗剂(rinse aid)已加注,缺漂洗剂是塑料餐具不干的主因;2) 选择带加热烘干的程序;3) 仍不干则测加热元件(W10518394)阻值,常温应为 15-30 欧姆,开路即损坏需更换;4) 加热元件正常则检查控制板上的加热继电器。",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Dishes-Not-Drying/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "不进水,进水缓慢",
    text:
      "洗碗机不进水:1) 确认进水角阀已开;2) 检查浮子开关(W10195039)是否被异物卡住,浮子卡在高位会切断进水;3) 进水阀(W10872255)线圈开路或滤网堵塞会导致不进水或进水缓慢,断电后测线圈阻值约 500-1500 欧姆;4) 门锁未到位整机不会启动,检查门锁总成。",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Filling/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "洗不干净,喷臂不转",
    text:
      "餐具洗不干净:1) 检查上下喷臂喷孔是否被水垢/残渣堵塞,可拆下用牙签疏通后温水冲洗;2) 喷臂轴承磨损导致不转需更换喷臂;3) 水压不足且喷臂正常,多为循环泵电机(W10510667)磨损;4) 定期用洗碗机清洁剂除垢可预防。",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Cleaning/",
  },
  {
    source_type: "transcript", part_no: "PS11752778", appliance_type: "refrigerator",
    symptom_tags: "搁架盒安装",
    text:
      "(安装视频字幕节选)大家好,今天更换惠而浦冰箱的门搁架盒。这个件不需要任何工具:先把旧盒子里的东西拿出来,两只手扣住盒子左右两边,直接往上一提就下来了。新盒子对准门上的两条卡槽,往下按到底,听到咔哒一声就装好了,整个过程不到一分钟。注意买的时候核对自己冰箱的型号,这个件适配大部分 Whirlpool 对开门机型。",
    source_url: "https://www.youtube.com/watch?v=ps11752778-demo", source_ref: "00:32",
  },
  {
    source_type: "transcript", part_no: "PS11756710", appliance_type: "dishwasher",
    symptom_tags: "加热元件更换,餐具不干",
    text:
      "(安装视频字幕节选)更换加热元件最容易忽略的两点:第一,接线端子在机器底盘下面,拆踢脚板之前一定先断电,可以用验电笔确认;第二,新元件穿过底孔后,密封橡胶圈要涂一点点洗洁精帮助就位,固定螺母拧到手紧再加四分之一圈即可,拧太紧会压裂密封圈导致漏水。装完先空跑一个快洗程序检查底部有没有渗水。",
    source_url: "https://www.youtube.com/watch?v=ps11756710-demo", source_ref: "03:15",
  },
  {
    source_type: "manual", part_no: "PS11770704", appliance_type: "refrigerator",
    symptom_tags: "制冰机安装,制冰机不工作",
    text:
      "(维修手册节选,第 12 页)制冰机模块更换后注意事项:首次通电后制冰机进入初始化,模块前端指示灯闪烁两次为正常自检。新制冰机首批冰块(前 2-3 批)建议丢弃。若 24 小时后仍未出冰,请检查供水管路与进水阀,并确认冷冻室温度已达到 0°F (-18°C)。",
    source_url: "https://www.partselect.com/Installation-Instructions/PS11770704/", source_ref: "p.12",
  },
];

function seed() {
  initSchema();
  const db = getDb();

  const wipe = db.transaction(() => {
    for (const t of [
      "order_items", "orders", "carts", "search_history", "user_appliances",
      "users", "doc_chunks", "install_guides", "compatibility", "parts", "appliance_models",
    ]) db.prepare(`DELETE FROM ${t}`).run();
  });
  wipe();

  const insertAll = db.transaction(() => {
    const insModel = db.prepare(
      "INSERT INTO appliance_models (model_no, brand, appliance_type, name) VALUES (?,?,?,?)"
    );
    const modelIds = new Map<string, number>();
    for (const [model_no, brand, type, name] of models) {
      const r = insModel.run(model_no, brand, type, name);
      modelIds.set(model_no, Number(r.lastInsertRowid));
    }

    const insPart = db.prepare(
      `INSERT INTO parts (part_no, mfr_part_no, name, description, appliance_type, brand, price, stock_qty, product_url, symptoms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const insCompat = db.prepare(
      "INSERT INTO compatibility (part_id, model_id) VALUES (?,?)"
    );
    const partIds = new Map<string, number>();
    for (const p of parts) {
      const r = insPart.run(
        p.part_no, p.mfr, p.name, p.desc, p.type, p.brand, p.price, p.stock,
        `https://www.partselect.com/${p.part_no}.htm`, p.symptoms
      );
      const id = Number(r.lastInsertRowid);
      partIds.set(p.part_no, id);
      for (const m of p.fits) {
        const mid = modelIds.get(m);
        if (mid) insCompat.run(id, mid);
      }
    }

    const insGuide = db.prepare(
      `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const g of guides) {
      insGuide.run(
        partIds.get(g.part_no)!, g.difficulty, g.minutes, g.tools,
        JSON.stringify(g.steps), g.video ?? null, g.manual ?? null
      );
    }

    const insChunk = db.prepare(
      `INSERT INTO doc_chunks (source_type, part_id, appliance_type, symptom_tags, chunk_text, source_url, source_ref)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const c of chunks) {
      insChunk.run(
        c.source_type, c.part_no ? partIds.get(c.part_no)! : null,
        c.appliance_type, c.symptom_tags, c.text, c.source_url ?? null, c.source_ref ?? null
      );
    }

    // 演示用户:已购两台家电 + 一笔历史订单(支撑"家电卡片"与"已购零件"视图)
    const uid = Number(
      db.prepare("INSERT INTO users (email, name) VALUES (?,?)")
        .run("demo@example.com", "演示用户").lastInsertRowid
    );
    const insUA = db.prepare(
      "INSERT INTO user_appliances (user_id, model_id, source) VALUES (?,?,?)"
    );
    insUA.run(uid, modelIds.get("WDT780SAEM1")!, "purchased");
    insUA.run(uid, modelIds.get("WRS325SDHZ01")!, "purchased");

    const binId = partIds.get("PS11752778")!;
    const oid = Number(
      db.prepare("INSERT INTO orders (user_id, total, status, card_last4) VALUES (?,?,?,?)")
        .run(uid, 36.18, "delivered", "4242").lastInsertRowid
    );
    db.prepare(
      "INSERT INTO order_items (order_id, part_id, qty, unit_price) VALUES (?,?,?,?)"
    ).run(oid, binId, 1, 36.18);
  });
  insertAll();

  const counts = {
    models: models.length,
    parts: parts.length,
    guides: guides.length,
    chunks: chunks.length,
  };
  console.log("Seed complete:", JSON.stringify(counts));
}

seed();
