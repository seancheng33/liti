/**
 * 演示环境的数据集。
 *
 * 这里只放「内容」，不放任何写库逻辑（写库在 seed.ts）。
 * 之所以认真造这套数据而不是随便插几张表：演示的效果全靠数据像不像真的——
 * 一套只有三道题的题库，成绩册里所有人的分数都一模一样，
 * 逐题分析的 P 值全是 1.00，那这个演示就白做了。
 *
 * 所以这里的题按真实考点写，easy/normal/hard 三档难度混着放，
 * 学生也分三六九等，这样出成绩之后才有像样的分布。
 */

export interface DemoCategory {
  name: string;
  children: string[];
}

export const DEMO_CATEGORIES: DemoCategory[] = [
  { name: '计算机基础', children: ['硬件基础', '操作系统', '网络基础', '办公软件'] },
];

export interface DemoQuestion {
  type: 'single' | 'multiple';
  stem: string;
  options: string[];
  /** 正确选项下标（0 起） */
  correct: number[];
  explanation: string;
  /** 归到哪个二级分类 */
  category: string;
  tags: string[];
  /** 0~1，越大越难。用来生成成绩分布，不是给学生看的 */
  difficulty: number;
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  // ---------------- 硬件基础（10 单选 + 3 多选） ----------------
  {
    type: 'single',
    stem: '计算机中负责执行指令、完成运算的核心部件是？',
    options: ['内存', '中央处理器（CPU）', '硬盘', '电源'],
    correct: [1],
    explanation: 'CPU 由运算器和控制器组成，指令的执行和算术逻辑运算都在这里完成。内存只是暂存待处理的数据。',
    category: '硬件基础',
    tags: ['CPU', '组成原理'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: '断电后数据会立即丢失的存储器是？',
    options: ['内存（RAM）', '机械硬盘', 'U 盘', '光盘'],
    correct: [0],
    explanation: 'RAM 靠电容存电荷，断电即清空。硬盘、U 盘、光盘都是非易失性存储。',
    category: '硬件基础',
    tags: ['内存', '存储'],
    difficulty: 0.15,
  },
  {
    type: 'single',
    stem: '下列属于输入设备的是？',
    options: ['显示器', '打印机', '键盘', '音箱'],
    correct: [2],
    explanation: '键盘把人的操作转成电信号送进计算机，属于输入设备；另外三个都是把结果送出来的输出设备。',
    category: '硬件基础',
    tags: ['外设'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: '一个字节（Byte）等于多少位（bit）？',
    options: ['4', '8', '16', '32'],
    correct: [1],
    explanation: '1 Byte = 8 bit，这是计算机里最基本的换算。带宽常说的「百兆」是 100 Mbps，除 8 才是每秒多少兆字节。',
    category: '硬件基础',
    tags: ['单位换算'],
    difficulty: 0.2,
  },
  {
    type: 'single',
    stem: 'CPU 主频的常用单位是？',
    options: ['GHz', 'MB', 'Mbps', 'V'],
    correct: [0],
    explanation: '主频指每秒的时钟周期数，单位 Hz（现在普遍是 GHz）。MB 是容量，Mbps 是带宽，V 是电压。',
    category: '硬件基础',
    tags: ['CPU'],
    difficulty: 0.15,
  },
  {
    type: 'single',
    stem: '固态硬盘（SSD）相比机械硬盘的主要优势是？',
    options: ['容量普遍更大', '单位容量价格更低', '无机械结构，随机读写更快', '更省电但速度更慢'],
    correct: [2],
    explanation: 'SSD 用闪存颗粒，没有磁头和盘片，寻道时间为零，所以随机读写快得多，也不怕震动。容量和单价上机械硬盘反而更划算。',
    category: '硬件基础',
    tags: ['SSD', '存储'],
    difficulty: 0.3,
  },
  {
    type: 'single',
    stem: '主板上的 UEFI/BIOS 芯片主要作用是？',
    options: ['开机自检并引导操作系统', '存储用户文件', '提供网络连接', '负责图像渲染'],
    correct: [0],
    explanation: '加电后先由固件做硬件自检，再把控制权交给引导程序，最后由引导程序加载操作系统。',
    category: '硬件基础',
    tags: ['主板', '启动流程'],
    difficulty: 0.4,
  },
  {
    type: 'single',
    stem: '既能传输视频又能传输音频的接口是？',
    options: ['USB 2.0', 'VGA', 'PS/2', 'HDMI'],
    correct: [3],
    explanation: 'HDMI 是数字音视频一体化接口。VGA 只有视频（还是模拟信号），PS/2 接键鼠，USB 2.0 传数据但不承载显示信号。',
    category: '硬件基础',
    tags: ['接口'],
    difficulty: 0.25,
  },
  {
    type: 'single',
    stem: '下列哪种设备可以在断电后长期保存数据？',
    options: ['寄存器', '高速缓存', '硬盘', '内存'],
    correct: [2],
    explanation: '寄存器、缓存、内存都属于易失性存储，断电内容就没了。硬盘是外存，断电仍保留。',
    category: '硬件基础',
    tags: ['存储层次'],
    difficulty: 0.2,
  },
  {
    type: 'single',
    stem: '显卡的核心作用是？',
    options: ['存储系统文件', '图形渲染与显示输出', '处理网络数据包', '为整机供电'],
    correct: [1],
    explanation: 'GPU 负责图形计算，把渲染结果通过显示接口送出去。现在也常拿来做通用并行计算，但本职仍是图形。',
    category: '硬件基础',
    tags: ['显卡'],
    difficulty: 0.15,
  },
  {
    type: 'multiple',
    stem: '下列属于输入设备的有？',
    options: ['显示器', '键盘', '扫描仪', '鼠标'],
    correct: [1, 2, 3],
    explanation: '键盘、鼠标、扫描仪都是把外部信息送进计算机；显示器是输出设备。',
    category: '硬件基础',
    tags: ['外设'],
    difficulty: 0.2,
  },
  {
    type: 'multiple',
    stem: '影响计算机运行速度的因素有哪些？',
    options: ['显示器尺寸', 'CPU 主频与核心数', '内存容量', '硬盘类型'],
    correct: [1, 2, 3],
    explanation: 'CPU 决定算得多快，内存决定能同时装多少活儿，硬盘决定读写等待时间。显示器尺寸只影响观感。',
    category: '硬件基础',
    tags: ['性能'],
    difficulty: 0.3,
  },
  {
    type: 'multiple',
    stem: '关于固态硬盘（SSD），说法正确的有？',
    options: ['同价位下容量普遍比机械硬盘大', '内部没有机械结构', '随机读写速度比机械硬盘快', '不怕摔碰，但高温会影响寿命'],
    correct: [1, 2, 3],
    explanation: 'SSD 无机械部件，抗震动、随机读写快；但闪存有写入寿命，过热会加速老化。同价位容量不如机械硬盘。',
    category: '硬件基础',
    tags: ['SSD'],
    difficulty: 0.45,
  },

  // ---------------- 操作系统（10 单选 + 1 多选） ----------------
  {
    type: 'single',
    stem: 'Windows 中打开任务管理器的快捷键是？',
    options: ['Ctrl + A', 'Ctrl + Shift + Esc', 'Alt + F4', 'Win + R'],
    correct: [1],
    explanation: 'Ctrl + Shift + Esc 直接调出任务管理器。Ctrl + Shift + Esc 被占用时，也可以 Ctrl + Alt + Del 再选。',
    category: '操作系统',
    tags: ['Windows', '快捷键'],
    difficulty: 0.2,
  },
  {
    type: 'single',
    stem: '下列不属于操作系统的是？',
    options: ['Windows 11', 'Ubuntu', 'Android', 'Photoshop'],
    correct: [3],
    explanation: 'Photoshop 是应用软件，跑在操作系统之上。Android 虽然装在手机上，但它确实是操作系统。',
    category: '操作系统',
    tags: ['概念'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: 'Linux 下列出当前目录内容的命令是？',
    options: ['ls', 'cd', 'rm', 'mkdir'],
    correct: [0],
    explanation: 'ls 列出目录内容，cd 切目录，rm 删除，mkdir 建目录。',
    category: '操作系统',
    tags: ['Linux', '命令'],
    difficulty: 0.25,
  },
  {
    type: 'single',
    stem: '文件扩展名 .exe 表示的文件类型是？',
    options: ['文本文件', '图片文件', '可执行程序', '压缩包'],
    correct: [2],
    explanation: '.exe 是 Windows 的可执行文件。注意扩展名只代表约定，不是安全保证，改个后缀照样能是病毒。',
    category: '操作系统',
    tags: ['文件类型'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: 'Windows 回收站的作用是？',
    options: ['永久删除文件', '暂存已删除文件，可还原', '清理内存占用', '备份整个系统'],
    correct: [1],
    explanation: '删除的文件先进回收站，还能还原；清空回收站才是真删。从 U 盘删除通常不进回收站。',
    category: '操作系统',
    tags: ['Windows', '文件管理'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: '路径中的「..」表示？',
    options: ['当前目录', '根目录', '上一级目录', '用户主目录'],
    correct: [2],
    explanation: '「.」是当前目录，「..」是上一级。所以 ../images 就是从当前目录往上走一层再进 images。',
    category: '操作系统',
    tags: ['路径'],
    difficulty: 0.35,
  },
  {
    type: 'single',
    stem: 'Windows 中「全选」的快捷键是？',
    options: ['Ctrl + C', 'Ctrl + V', 'Ctrl + A', 'Ctrl + Z'],
    correct: [2],
    explanation: 'Ctrl + A 全选（A 来自 All），Ctrl + C 复制，Ctrl + V 粘贴，Ctrl + Z 撤销。',
    category: '操作系统',
    tags: ['快捷键'],
    difficulty: 0.05,
  },
  {
    type: 'single',
    stem: 'Windows 系统盘常用的文件系统是？',
    options: ['NTFS', 'EXT4', 'APFS', 'HFS+'],
    correct: [0],
    explanation: 'NTFS 是 Windows 的主力文件系统。EXT4 是 Linux 的，APFS 和 HFS+ 是 macOS 的。',
    category: '操作系统',
    tags: ['文件系统'],
    difficulty: 0.4,
  },
  {
    type: 'single',
    stem: '任务管理器里「结束任务」的效果是？',
    options: ['正常保存并退出程序', '强制终止该程序', '重启操作系统', '卸载该软件'],
    correct: [1],
    explanation: '这是强杀进程，程序来不及保存，未保存的内容会丢。只在程序卡死时用。',
    category: '操作系统',
    tags: ['Windows', '进程'],
    difficulty: 0.25,
  },
  {
    type: 'single',
    stem: '关于快捷方式（.lnk 文件），说法正确的是？',
    options: ['它是一份原文件的副本', '它只是指向原文件的一条链接', '删除它会把原文件一起删掉', '它和原文件占用同样大的空间'],
    correct: [1],
    explanation: '快捷方式只存路径信息，几十字节；删掉快捷方式不影响原文件，反过来原文件被移走，快捷方式就失效了。',
    category: '操作系统',
    tags: ['Windows', '文件管理'],
    difficulty: 0.5,
  },
  {
    type: 'multiple',
    stem: '下列属于操作系统的有？',
    options: ['Word', 'Windows', 'Linux', 'macOS'],
    correct: [1, 2, 3],
    explanation: 'Word 是办公软件，其余三个都是操作系统。',
    category: '操作系统',
    tags: ['概念'],
    difficulty: 0.1,
  },

  // ---------------- 网络基础（8 单选 + 2 多选） ----------------
  {
    type: 'single',
    stem: 'IPv4 地址由多少位二进制数组成？',
    options: ['16 位', '32 位', '64 位', '128 位'],
    correct: [1],
    explanation: 'IPv4 是 32 位，写成四段十进制（如 192.168.1.1）。IPv6 才是 128 位。',
    category: '网络基础',
    tags: ['IP'],
    difficulty: 0.3,
  },
  {
    type: 'single',
    stem: 'HTTP 协议默认使用的端口号是？',
    options: ['80', '443', '22', '3306'],
    correct: [0],
    explanation: 'HTTP 默认 80，HTTPS 默认 443，SSH 是 22，MySQL 是 3306。',
    category: '网络基础',
    tags: ['端口'],
    difficulty: 0.2,
  },
  {
    type: 'single',
    stem: '把域名解析成 IP 地址的协议是？',
    options: ['FTP', 'SMTP', 'DNS', 'DHCP'],
    correct: [2],
    explanation: 'DNS 就是互联网的电话簿。FTP 传文件，SMTP 发邮件，DHCP 分配 IP。',
    category: '网络基础',
    tags: ['DNS'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: '局域网中自动分配 IP 地址的服务是？',
    options: ['DNS', 'DHCP', 'NAT', 'VPN'],
    correct: [1],
    explanation: 'DHCP 负责自动下发 IP、网关、DNS。没有它就得每台机器手工配，改一次网段要跑遍全楼。',
    category: '网络基础',
    tags: ['DHCP'],
    difficulty: 0.3,
  },
  {
    type: 'single',
    stem: '下列属于私有（内网）IP 地址的是？',
    options: ['192.168.1.10', '8.8.8.8', '114.114.114.114', '202.96.128.86'],
    correct: [0],
    explanation: '私有地址段是 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16，只能在局域网内用，不能直接在公网路由。',
    category: '网络基础',
    tags: ['IP', '内网'],
    difficulty: 0.35,
  },
  {
    type: 'single',
    stem: 'HTTPS 相比 HTTP 最主要的变化是？',
    options: ['传输速度更快', '支持更大的文件', '增加了加密与身份验证', '不再需要域名'],
    correct: [2],
    explanation: 'HTTPS 在 HTTP 之下加了 TLS，内容被加密、服务器身份被证书校验。代价是多一次握手，略慢一点。',
    category: '网络基础',
    tags: ['HTTPS', '安全'],
    difficulty: 0.3,
  },
  {
    type: 'single',
    stem: 'ping 命令使用的协议是？',
    options: ['TCP', 'UDP', 'ICMP', 'ARP'],
    correct: [2],
    explanation: 'ping 发的是 ICMP 回显请求，用来测连通性和延迟。有些服务器会禁 ICMP，所以 ping 不通不代表服务挂了。',
    category: '网络基础',
    tags: ['排障'],
    difficulty: 0.45,
  },
  {
    type: 'single',
    stem: '默认网关的作用是？',
    options: ['给本机分配 IP 地址', '缓存网页内容', '转发去往其他网段的数据', '过滤病毒'],
    correct: [2],
    explanation: '目的地址不在本网段时，数据交给网关（通常就是路由器）转发出去。网关配错，内网通、外网不通。',
    category: '网络基础',
    tags: ['网关'],
    difficulty: 0.4,
  },
  {
    type: 'multiple',
    stem: '下列属于网络互联设备的有？',
    options: ['路由器', '打印机', '交换机', '无线 AP'],
    correct: [0, 2, 3],
    explanation: '路由器、交换机、无线 AP 都负责数据转发或接入；打印机是终端设备。',
    category: '网络基础',
    tags: ['网络设备'],
    difficulty: 0.2,
  },
  {
    type: 'multiple',
    stem: '保护上网安全的做法包括？',
    options: ['把密码写在便签上贴在显示器边', '安装杀毒软件并及时更新', '定期给系统打补丁', '不同网站使用不同的复杂密码'],
    correct: [1, 2, 3],
    explanation: '补丁、杀软、独立强密码是基础三件套。密码贴显示器等于把钥匙插在门上。',
    category: '网络基础',
    tags: ['安全'],
    difficulty: 0.15,
  },

  // ---------------- 办公软件（4 单选 + 2 多选） ----------------
  {
    type: 'single',
    stem: 'Excel 中用于求和的函数是？',
    options: ['SUM', 'ADD', 'TOTAL', 'PLUS'],
    correct: [0],
    explanation: 'SUM 求和，AVERAGE 求平均，COUNT 计数，MAX/MIN 取极值。',
    category: '办公软件',
    tags: ['Excel', '函数'],
    difficulty: 0.05,
  },
  {
    type: 'single',
    stem: 'Excel 中单元格地址 A1 表示？',
    options: ['第 1 列第 A 行', '第 A 列第 1 行', '第 1 个工作表', '第 A 个区域'],
    correct: [1],
    explanation: '列在前、行在后：A 是列标，1 是行号。所以 C5 是第 C 列第 5 行。',
    category: '办公软件',
    tags: ['Excel'],
    difficulty: 0.2,
  },
  {
    type: 'single',
    stem: 'Word 中把选中文字加粗的快捷键是？',
    options: ['Ctrl + I', 'Ctrl + U', 'Ctrl + B', 'Ctrl + D'],
    correct: [2],
    explanation: 'Ctrl + B 加粗（Bold），Ctrl + I 斜体，Ctrl + U 下划线。',
    category: '办公软件',
    tags: ['Word', '快捷键'],
    difficulty: 0.1,
  },
  {
    type: 'single',
    stem: 'Excel 中表示绝对引用的符号是？',
    options: ['$', '@', '#', '&'],
    correct: [0],
    explanation: '$A$1 行列都锁定，$A1 只锁列，A$1 只锁行。往下拖公式不想让引用跟着跑，就得加 $。',
    category: '办公软件',
    tags: ['Excel', '公式'],
    difficulty: 0.5,
  },
  {
    type: 'multiple',
    stem: 'Excel 中常用于统计的函数有？',
    options: ['SUM', 'BOLD', 'AVERAGE', 'COUNT'],
    correct: [0, 2, 3],
    explanation: 'SUM/AVERAGE/COUNT 都是统计函数。BOLD 不是函数，是「加粗」这个操作的名字，Excel 里没有这个函数。',
    category: '办公软件',
    tags: ['Excel', '函数'],
    difficulty: 0.3,
  },
  {
    type: 'multiple',
    stem: '下列文件扩展名属于图片格式的有？',
    options: ['.docx', '.jpg', '.png', '.gif'],
    correct: [1, 2, 3],
    explanation: '.docx 是 Word 文档。jpg/png/gif 都是常见图片格式，gif 还能动。',
    category: '办公软件',
    tags: ['文件类型'],
    difficulty: 0.1,
  },
];

export interface DemoStudent {
  username: string;
  displayName: string;
  className: string;
  studentNo: string;
  /** 0~1，越高越能答对。用来生成像样的成绩分布 */
  level: number;
}

/**
 * 按班生成学生。username 用全局连续编号（stu01…stu24），
 * 学号用「年份 + 四位数」——两个班号里都带 2301，按班号拼学号一定撞。
 */
function studentsOf(className: string, startIndex: number, names: string[], levels: number[]): DemoStudent[] {
  return names.map((displayName, i) => {
    const n = startIndex + i + 1;
    return {
      username: `stu${String(n).padStart(2, '0')}`,
      displayName,
      className,
      studentNo: `2024${String(n).padStart(4, '0')}`,
      level: levels[i % levels.length],
    };
  });
}

export const DEMO_TEACHERS = [
  { username: 'teacher', displayName: '张海燕', password: 'teacher123' },
  { username: 'teacher2', displayName: '陈志强', password: 'teacher123' },
] as const;

export const DEMO_ADMIN = { username: 'admin', displayName: '李建国', password: 'admin123' } as const;

/** 演示学生的统一密码。登录页会直接写出来，演示环境不需要藏着 */
export const DEMO_STUDENT_PASSWORD = 'student123';

export const DEMO_STUDENTS: DemoStudent[] = [
  ...studentsOf(
    '计算机2301',
    0,
    ['王雨萌', '李子豪', '张欣然', '刘博文', '陈思远', '赵佳怡', '杨皓宇', '周梦琪'],
    [0.86, 0.42, 0.74, 0.61, 0.33, 0.9, 0.55, 0.68],
  ),
  ...studentsOf(
    '计算机2302',
    8,
    ['吴俊杰', '徐雅静', '孙浩然', '马晓彤', '朱天宇', '胡明轩', '郭若彤', '何嘉懿'],
    [0.58, 0.79, 0.36, 0.71, 0.47, 0.63, 0.88, 0.29],
  ),
  ...studentsOf(
    '网络2301',
    16,
    ['高子涵', '林一鸣', '罗雨欣', '梁俊熙', '宋佳琪', '唐宇航', '韩雪儿', '曹文博'],
    [0.66, 0.51, 0.82, 0.39, 0.7, 0.44, 0.76, 0.57],
  ),
];

export interface DemoGroup {
  name: string;
  remark: string;
  /** 按班级圈人 */
  className: string;
}

export const DEMO_GROUPS: DemoGroup[] = [
  { name: '计算机2301 全班', remark: '期中、期末统一使用', className: '计算机2301' },
  { name: '计算机2302 全班', remark: '', className: '计算机2302' },
  { name: '补考名单', remark: '期中不及格的同学，期末前加练', className: '网络2301' },
];

/** 站点公告，演示环境写在登录页上，比空荡荡好看 */
export const DEMO_ANNOUNCEMENT =
  '演示环境：数据每小时自动还原，可以随意点、随意改，不用担心弄坏。'
  + '想体验真实操作，用下面的「一键体验」直接进。';

export const DEMO_SITE_NAME = '砺题 Liti · 演示';
