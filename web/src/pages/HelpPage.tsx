import { Alert, Anchor, Card, Col, Collapse, Divider, Row, Space, Spin, Steps, Table, Tag, Typography } from 'antd';
import {
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  EyeOutlined,
  FileTextOutlined,
  FormOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth';
import AppLayout from '../components/AppLayout';
import PublicShell from '../components/PublicShell';
import PageHeader from '../components/PageHeader';
import { SUBMIT_REASON_LABEL } from '../types';

const { Paragraph, Text, Title } = Typography;

const ROLE_ROWS = [
  { key: 'student', role: '学生', scope: '答题、看自己的成绩与解析、练习中心（随机练习 + 错题练习）、自己的错题本' },
  {
    key: 'teacher',
    role: '教师',
    scope: '学生的全部能力 + 题库（含导入导出）、分类管理、学生分组、学生账号管理、组卷发布、统计、导出成绩',
  },
  {
    key: 'admin',
    role: '管理员',
    scope: '教师的全部能力 + 用户管理（含教师与管理员账号）、网站配置（站名、公告、默认参数、练习开关）',
  },
];

const TEMPLATE_ROWS = [
  { key: 'type', col: '题型', rule: '下拉选择「单选」或「多选」，必填' },
  { key: 'stem', col: '题干', rule: '题目文字；只放配图的题目可以留空，但要在系统里补图' },
  { key: 'opt', col: '选项A – 选项F', rule: '至少填 A、B 两项；不用的小题留空即可' },
  { key: 'answer', col: '正确答案', rule: '单选填一个字母（B）；多选填多个（ACD），不区分大小写' },
  { key: 'explain', col: '解析', rule: '可选，交卷后展示给答题人' },
  { key: 'cat', col: '分类', rule: '填已有分类名；留空归为「未分类」' },
  { key: 'tags', col: '标签', rule: '多个标签用逗号分隔，如：数学,入门' },
];

const FAQ = [
  {
    key: 'q1',
    label: '图片上传失败怎么办？',
    children: (
      <Paragraph>
        配图通过接口上传到服务器，单张不能超过 <Text strong>4 MB</Text>，只支持 png / jpg / webp / gif。
        如果提示「图片不能超过 4MB」，先用截图工具或压缩工具压一下再传。
        上传成功后图片会存在服务器的 <Text code>data/uploads</Text> 目录里，备份数据库时别忘了它。
      </Paragraph>
    ),
  },
  {
    key: 'q2',
    label: '保存题目时提示「题库中已存在相同题目」',
    children: (
      <Paragraph>
        系统会对题干做一次宽松比对（忽略空格和标点），命中后返回已有题目供你确认。
        确认确实是不同题目，可以在弹窗里选「仍然保存」；如果是重复录入，直接取消即可。
        Excel 导入时也可以在导入前选择「重复跳过 / 已存在则不导入 / 允许重复」。
      </Paragraph>
    ),
  },
  {
    key: 'q3',
    label: '按分类随机抽题时说题目不足',
    children: (
      <Paragraph>
        说明该分类下的题目数量少于你填的抽题数量，或者多条规则之间抢同一批题。
        可以把抽题数量调小、把分类留空（从全题库抽），或者先去题库补充题目。
      </Paragraph>
    ),
  },
  {
    key: 'q4',
    label: '学生看不到试卷 / 点开始答题没反应',
    children: (
      <Paragraph>
        试卷创建后默认是 <Tag>草稿</Tag> 状态，只有改成 <Tag color="green">已发布</Tag> 才会出现在学生端和首页。
        另外如果发布时选了 <Tag color="geekblue">指定学生</Tag>，没被点名的学生也看不到这份卷子 ——
        去试卷列表点「可见范围」确认一下名单。
      </Paragraph>
    ),
  },
  {
    key: 'q5',
    label: '答题中途切到别的窗口会怎样？',
    children: (
      <Paragraph>
        系统会检测切换窗口和标签页：回来时弹窗提醒并记一次违规，累计 <Text strong>3 次</Text> 会自动强制交卷，
        交卷原因记为「异常：违规强制交卷」。需要离开一会儿请用「暂停」，暂停期间计时停止、题面隐藏，切屏也不算违规。
        答题过程中答案会自动保存（顶部有保存状态），已经存到服务器的答案，重新进入能接着答；网络中断时答案会先留在本地并自动重试。
      </Paragraph>
    ),
  },
  {
    key: 'q5b',
    label: '删除题目会影响以前考过的试卷吗？',
    children: (
      <Paragraph>
        不会。删除只是把题目从题库隐藏（不再出现在列表、不会被新卷抽到），
        但已经组进试卷的题目会完整保留 —— 老试卷还能预览、还能作答，已经交卷的解析也照常显示。
      </Paragraph>
    ),
  },
  {
    key: 'q5c',
    label: '一份试卷可以考几次？',
    children: (
      <Paragraph>
        默认 3 次。只有交卷或超时才算用掉一次；开了卷没交就退出去，再点「开始答题」会接着那张卷子继续。
        次数用完之后按钮会变成灰色的「次数已用完」。练习卷不计次数。
      </Paragraph>
    ),
  },
  {
    key: 'q6',
    label: '忘记密码了',
    children: (
      <Paragraph>
        找管理员在「用户管理」里重置密码。管理员自己也忘记了，只能由服务器维护人员在数据库里重置，
        或重新初始化账号。
      </Paragraph>
    ),
  },
  {
    key: 'q7',
    label: '界面颜色不喜欢',
    children: (
      <Paragraph>
        右上角的主题按钮可以在 7 套配色之间切换，包括深色模式。
        选择会跟着账号走，换台电脑登录还是你选的那套；没登录时只记在这台浏览器上。
      </Paragraph>
    ),
  },
  {
    key: 'q8',
    label: '错题本里的题是怎么进来的？会自己消失吗？',
    children: (
      <Paragraph>
        每次交卷判分时，答错的题（包括空着没答的）会自动进你的错题本，并记一次错误次数。
        后来同一道题做对了，它会从「待订正」移到「已订正」，记录仍然留着；再做错又会回到待订正。
        想彻底清掉，在错题本里勾选后「批量移除」即可。错题本只有你自己能看到。
      </Paragraph>
    ),
  },
  {
    key: 'q9',
    label: '分组可见和指定学生有什么区别？',
    children: (
      <Paragraph>
        「指定学生」是点名字，名单是发布那一刻定下的；「分组」挂的是组本身，
        组里加人减人，试卷的可见范围会跟着变 —— 转学生进来塞进组里，之前的卷子他立刻就能看。
        两个可以一起用，取并集。
      </Paragraph>
    ),
  },
  {
    key: 'q10',
    label: '导出的题库表格能直接改完再导回去吗？',
    children: (
      <Paragraph>
        可以。导出用的是和「模板」一样的 12 列结构，改完直接走「Excel 导入」就行。
        两点注意：导出的表格里<Text strong>不含题目配图</Text>（模板没有图片列）；
        导回去时按题干查重，题干没改的行会被判成「重复」。
      </Paragraph>
    ),
  },
];

export default function HelpPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 120, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 登录后用站内布局，未登录用公开外壳，两种情况都能从侧边/页头跳走
  return user ? (
    <AppLayout>
      <HelpBody />
    </AppLayout>
  ) : (
    <PublicShell>
      <HelpBody />
    </PublicShell>
  );
}

function HelpBody() {
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';
  // 审计日志只有管理员能看，帮助目录也要跟着藏，否则点进去是一片报错
  const isAdmin = user?.role === 'admin';

  return (
    <div className="liti-page">
      <PageHeader
        title="使用帮助"
        description="从建题到出成绩的完整说明。按左侧目录跳转，遇到问题先看最后的常见问题。"
      />

      <Row gutter={24}>
        <Col xs={0} lg={5}>
          <div style={{ position: 'sticky', top: 88 }}>
            <Anchor
              affix={false}
              items={[
                { key: 'start', href: '#start', title: '快速开始' },
                { key: 'roles', href: '#roles', title: '角色与权限' },
                { key: 'question', href: '#question', title: '题库与配图' },
                { key: 'excel', href: '#excel', title: 'Excel 批量导入' },
                { key: 'paper', href: '#paper', title: '组卷与发布' },
                { key: 'practice', href: '#practice', title: '练习中心与错题本' },
                { key: 'groups', href: '#groups', title: '学生分组与账号' },
                { key: 'exam', href: '#exam', title: '答题与防作弊' },
                { key: 'review', href: '#review', title: '交卷与解析' },
                { key: 'stats', href: '#stats', title: '成绩与统计' },
                { key: 'analysis', href: '#analysis', title: '逐题分析' },
                { key: 'proctor', href: '#proctor', title: '实时监考' },
                ...(isAdmin ? [{ key: 'audit', href: '#audit', title: '审计日志' }] : []),
                { key: 'faq', href: '#faq', title: '常见问题' },
              ]}
            />
          </div>
        </Col>

        <Col xs={24} lg={19}>
          <Card id="start" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <PlayCircleOutlined /> 快速开始
            </Title>
            <Paragraph type="secondary">第一次用，照着三步走就行。</Paragraph>
            <Steps
              direction="vertical"
              size="small"
              current={-1}
              items={[
                {
                  title: '建题库',
                  description: '在「题库」里逐题录入，或用 Excel 模板批量导入；题干和选项都能配图。',
                },
                {
                  title: '组卷并发布',
                  description: '在「试卷」里新建卷子 —— 可以按分类随机抽题，也可以直接从题库手选；设好时长、及格分，点「发布」。',
                },
                {
                  title: '学生作答',
                  description: '学生登录后在首页或「试卷」页点「开始答题」，交卷后立刻能看到分数和每题解析。',
                },
              ]}
            />
            <Alert
              type="info"
              showIcon
              message="没登录也能先逛逛"
              description="首页不需要登录就能看到题库规模、已发布试卷，以及每份卷子的题面预览。点「开始答题」会跳到登录页，登录完自动把你带回那张卷子并开考。"
            />
          </Card>

          <Card id="roles" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <TeamOutlined /> 角色与权限
            </Title>
            <Table
              size="small"
              pagination={false}
              columns={[
                { title: '角色', dataIndex: 'role', width: 100, render: (v: string) => <Tag color={v === '管理员' ? 'red' : v === '教师' ? 'blue' : 'green'}>{v}</Tag> },
                { title: '能做什么', dataIndex: 'scope' },
              ]}
              dataSource={ROLE_ROWS}
            />
            <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
              账号由管理员在「用户管理」里创建；教师可以维护题库和试卷，但不能改用户和站点配置。
            </Paragraph>
          </Card>

          <Card id="question" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <BookOutlined /> 题库与配图
            </Title>
            <Paragraph>
              题目分单选和多选两种。一道题由「题干 + 若干选项 + 正确答案 + 解析」组成，
              题干和每个选项都可以额外配图，所以纯图片题也能出（题干留空、只放图即可）。
            </Paragraph>
            <Space direction="vertical" size={6} style={{ marginBottom: 12 }}>
              <Text>· 题干最多 6 张图，每个选项最多 3 张图。</Text>
              <Text>· 图片格式 png / jpg / webp / gif，单张 4 MB 以内。</Text>
              <Text>· 保存时会自动和已有题目查重，命中重复会先问你。</Text>
              <Text>· 勾选左侧方框可以<Text strong>批量改分类</Text>或<Text strong>批量删除</Text>。</Text>
            </Space>
            <Alert
              type="warning"
              showIcon
              message="选择题至少要有一个正确答案"
              description="单选题只能勾一个正确选项，多选题至少勾两个。选项少于两个的题目保存会被拦下。"
            />
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="删除题目只是从题库移除，已经组进试卷的照常显示"
              description="历史试卷、已发布试卷和已经交过的答卷里，这道题依然能正常看到题面和解析；只是它不会再出现在题库列表，也不会被新的随机抽题抽到。"
            />
          </Card>

          <Card id="excel" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <FormOutlined /> Excel 批量导入
            </Title>
            <Paragraph>
              题库页右上角有「模板」按钮，下载的模板里「题型」列是<Text strong>下拉菜单</Text>，
              点单元格右侧箭头选「单选 / 多选」就行，不用记格式。表头每个单元格都有批注，鼠标悬停能看到填写要求，
              模板里还有第二张「填写说明」工作表。
            </Paragraph>
            <Table
              size="small"
              pagination={false}
              style={{ marginBottom: 12 }}
              columns={[
                { title: '列', dataIndex: 'col', width: 140 },
                { title: '怎么填', dataIndex: 'rule' },
              ]}
              dataSource={TEMPLATE_ROWS}
            />
            <Paragraph>
              导入分三步：选文件 → 系统预校验（逐行报错，不会写库）→ 确认导入。
              重复题目的处理方式可以在导入前选：
              <Tag>重复跳过</Tag>
              <Tag>已存在则不导入</Tag>
              <Tag>允许重复</Tag>
            </Paragraph>
            <Alert
              type="info"
              showIcon
              message="导出：列结构和模板完全一致"
              description="题库页右上角「导出」会把当前筛选结果导出成 Excel，列和模板一模一样，所以「导出 → 在 Excel 里改 → 再导入」是通的。注意导出的表格里不含题目配图（模板本来就没有图片列）。"
            />
          </Card>

          <Card id="practice" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <ThunderboltOutlined /> 练习中心与错题本
            </Title>
            <Paragraph>
              左侧导航的「练习中心」是学生自己练手的地方，有两种练法：
            </Paragraph>
            <Space direction="vertical" size={8} style={{ marginBottom: 12 }}>
              <Text>
                <Tag color="blue">随机练习</Tag>
                选分类（可以多选，题量会平均分到各分类）和题量，系统当场抽一份卷子给你。
                每次抽到的题都不一样。
              </Text>
              <Text>
                <Tag color="orange">错题练习</Tag>
                只从你自己「还没订正」的错题里抽，专门补短板。
              </Text>
            </Space>
            <Paragraph>
              练习卷和正式试卷的区别：<Text strong>不计入「每卷 3 次」的限制</Text>、交卷后立刻能看解析、
              不会出现在「试卷」列表里。成绩照样记在「我的答卷」里。
            </Paragraph>
            <Alert
              type="warning"
              showIcon
              style={{ margin: '4px 0 12px' }}
              message="错题本是每人一份，互相看不到"
              description={
                <Space direction="vertical" size={2}>
                  <Text>题目会在<Text strong>交卷判分之后</Text>才进错题本，所以不会提前泄露你还没考的卷子的答案。</Text>
                  <Text>做对一次就自动从「待订正」里移出；再错一次会重新回来，并累计错误次数。</Text>
                  <Text>题目如果在题库里被删了，错题记录仍然保留，可以继续复习。</Text>
                </Space>
              }
            />
            <Paragraph>
              「错题本」页可以按分类筛、按题干搜，点「查看」能看到原题、正确答案和解析；
              勾选多道可以批量移除，也可以一键「用错题练一遍」。
            </Paragraph>
          </Card>

          <Card id="groups" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <ApartmentOutlined /> 学生分组与账号管理
            </Title>
            <Paragraph>
              学生多的时候，发布试卷一个个点名字太慢，可以先分组：左侧导航「学生分组」→ 新建分组（比如「高一（1）班」）
              → 点「管成员」把学生勾进来。之后发布试卷时选<Text strong>按分组</Text>就能整组发。
            </Paragraph>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message="试卷挂的是分组，不是名单快照"
              description="往组里加人之后，之前发给这个组的试卷他也能立刻看到，不用重新发布。把学生移出分组，他也立刻看不到。"
            />
            <Paragraph>
              教师可以在「学生管理」里创建学生账号、改显示名、重置密码、停用或删除学生。
              为了安全，教师<Text strong>只能管学生</Text>：不能创建教师/管理员、不能改别人的角色、也不能给自己提权。
              管理员账号仍然只有管理员能操作。
            </Paragraph>
          </Card>

          <Card id="paper" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <FileTextOutlined /> 组卷与发布
            </Title>
            <Paragraph>新建试卷时组卷方式有两种，可以按需要选：</Paragraph>
            <Space direction="vertical" size={8} style={{ marginBottom: 12 }}>
              <Text>
                <Tag color="purple">按分类随机抽题</Tag>
                可以添加多条规则，每条指定「从哪个分类抽几题」。分类留空就是从整个题库抽。
                适合平时测验，每次抽到的题不固定。
              </Text>
              <Text>
                <Tag color="blue">从题库手选题目</Tag>
                打开选题器，按关键词 / 分类 / 题型筛选，勾选需要的题目，题序就是勾选顺序。
                适合正式考试，要精确控制题目。
              </Text>
            </Space>
            <Paragraph>
              表单填完可以点底部的「预览卷面」，先看看考生会看到什么（预览不含答案）。
              保存后卷子是草稿状态，确认没问题再点「发布」，学生才能作答。
            </Paragraph>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="发布时可以选「对哪些学生可见」"
              description={
                <Space direction="vertical" size={2}>
                  <Text>
                    <Tag>所有学生</Tag>：发布后出现在所有人的试卷列表和首页。
                  </Text>
                  <Text>
                    <Tag color="geekblue">指定学生 / 分组</Tag>：只给点名的学生，以及勾选分组里的学生看（两者并集）。
                    不在范围内的学生连这份卷子都看不到，不是只挡住「开始答题」。发布后还能点「可见范围」随时改。
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    经常要整班发卷的话，先在「学生分组」里把人分好，发布时直接选分组更省事。
                  </Text>
                </Space>
              }
            />
            <Alert
              type="info"
              showIcon
              message="每份试卷最多作答 3 次"
              description="交卷或超时才算用掉一次；中途退出再点「开始答题」会接着上次那张卷子，不会白白占次数。练习卷不受这个限制。"
            />
            <Alert
              type="info"
              showIcon
              message="其他参数"
              description={
                <Space direction="vertical" size={2}>
                  <Text>时长：整卷倒计时，到点自动交卷，原因记为「异常：超时交卷」。</Text>
                  <Text>及格分：只影响成绩页的「及格 / 不及格」判定，不影响得分。</Text>
                  <Text>解析时机：选「交卷后」整卷交完统一看解析；选「即时」每题答完就能看答案。</Text>
                  <Text>选项乱序：开考时每个学生的选项顺序都会重新打乱，防抄袭。</Text>
                  <Text>
                    题序乱序：连题目顺序也每人一份，防「第 3 题选 B」这种对暗号。开了以后
                    <Text strong>「第几题」在师生之间就对不上了</Text>，讲评时请按题目说，别按序号说；
                    老师看卷面和预览永远是出题顺序，学生看的是自己那份。
                  </Text>
                </Space>
              }
            />
          </Card>

          <Card id="exam" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <PlayCircleOutlined /> 答题与防作弊
            </Title>
            <Paragraph>
              答题页是一题一张卡片，卡片下方有答题卡，可以点题号跳转，已答的题会标绿。
              顶部显示剩余时间、已答题数、保存状态、标记题数和违规次数。
            </Paragraph>
            <Space direction="vertical" size={6} style={{ marginBottom: 12 }}>
              <Text>
                · 每次选择都会自动保存，刷新或断网重连后接着答。顶部会显示保存状态：绿色的「答案已保存」表示已经存到服务器；
                橙色「网络不稳，N 题重试中」是在自动重试，不用你做什么，继续答题就行。
              </Text>
              <Text>
                · 万一网络一直不通，状态会变成「N 题未同步」。这时候答案还在你这台电脑上，别刷新页面、别关浏览器；
                交卷时这些答案会随交卷一起提交，照样算分。
              </Text>
              <Text>
                · 拿不准的题点右上角「标记」，答题卡上会出现小圆点，全部标记的题回头一起看。
              </Text>
              <Text>
                · 需要临时离开，点「暂停」：计时停止，题面会被隐藏起来，回来点「继续考试」接着答。
                暂停时长不计入考试时间。
              </Text>
              <Text>· 切换窗口 / 标签页会被记录，累计 3 次自动强制交卷。</Text>
              <Text>· 倒计时归零自动交卷，已答的题照常判分。</Text>
            </Space>
            <Alert
              type="warning"
              showIcon
              message="离开页面会被记一次违规"
              description="切到别的标签页、切到别的程序、直接关掉页面，回来都会弹窗提醒并记一次。要离开一会儿请用「暂停」，暂停期间的切屏不算违规。累计 3 次自动强制交卷。"
            />
          </Card>

          <Card id="review" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <ProfileOutlined /> 交卷与解析
            </Title>
            <Paragraph>
              交卷后立刻判分。多选题按「全对得分」算，少选、多选都不得分。
              解析页会标出正确选项和你选错的选项，并展示题目配图和解析文字。
            </Paragraph>
            <Paragraph style={{ marginBottom: 4 }}>成绩单上的「交卷原因」有三种：</Paragraph>
            <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
              <Text>
                <Tag color="green">{SUBMIT_REASON_LABEL.manual}</Tag>自己点的交卷
              </Text>
              <Text>
                <Tag color="orange">{SUBMIT_REASON_LABEL.timeout}</Tag>倒计时结束自动交卷
              </Text>
              <Text>
                <Tag color="red">{SUBMIT_REASON_LABEL.violation}</Tag>切屏次数累计到 3 次被强制交卷
              </Text>
            </Space>
            <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
              注意：解析时机如果是「交卷后」，交卷前看不到答案；教师端可以随时预览卷面。
            </Paragraph>
          </Card>

          <Card id="stats" style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginTop: 0 }}>
              <SettingOutlined /> 成绩、统计与站点配置
            </Title>
            <Paragraph>
              学生在「我的答卷」里能看到每次作答的得分、交卷原因，点进去还有逐题解析。
              教师和管理员在「统计」里能看到题目规模、答卷量、平均得分率，以及按分类的正确率；
              试卷页的「更多」里可以「导出成绩」，导出的 Excel 里交卷原因也是中文。
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              管理员还能在「网站管理」改站点名称、登录页公告、新建试卷的默认时长和及格分，以及是否允许学生自助练习。
              这些改动保存后立即生效。
            </Paragraph>
            {isManager && (
              <Alert
                type="success"
                showIcon
                style={{ marginTop: 12 }}
                message="你是教师/管理员"
                description="除了上面的内容，你还可以进「题库」「分类管理」维护题目结构，在「试卷」页组卷、发布、导出成绩。"
              />
            )}
          </Card>

          {isManager && (
            <Card id="analysis" style={{ marginBottom: 16 }}>
              <Title level={4} style={{ marginTop: 0 }}>
                <BarChartOutlined /> 逐题分析
              </Title>
              <Paragraph>
                考完之后想知道「哪道题出坏了」，用试卷页「更多」里的<Text strong>逐题分析</Text>。
                它给出的不是分数榜，是每一道题的表现：
              </Paragraph>
              <Space direction="vertical" size={6} style={{ marginBottom: 12 }}>
                <Text>
                  · <Text strong>正确率 P</Text>：答对人数 ÷ 实考人数。0.3–0.85 算合适，太低偏难、太高偏易。
                </Text>
                <Text>
                  · <Text strong>区分度 D</Text>：总分高的那批人和总分低的那批人，在这道题上差多少。
                  0.3 以上是好题，0.2 以下说明好差学生答得差不多。D 为负要特别当心——多半是答案标反了。
                </Text>
                <Text>
                  · <Text strong>选项分布</Text>：每个选项有多少人选。某个干扰项几乎没人选，说明它是废选项；
                  某个干扰项比正确答案还热门，多半是陷阱题或答案有问题。
                </Text>
                <Text>
                  · <Text strong>分数段分布</Text>：一眼看出这次是「大部分人都会」还是「两极分化」。
                </Text>
              </Space>
              <Paragraph>
                表格默认列全部题，切到<Text strong>「只看需关注」</Text>就只剩判为偏难、偏易、区分度低或疑似答案有误的那几道；
                点每行左边的加号能展开看选项分布。顶部可以按班级单独分析，右上角「导出分析」出 Excel
                （逐题、分数分布、考试信息三张表），直接发给教研或年级组长。
              </Paragraph>
              <Alert
                type="info"
                showIcon
                message="统计口径"
                description="只统计已交卷（含超时、违规、强制收卷）的答卷，每人取最近一次；进行中的答卷不算。实考人数不足 8 人时不给 D 值——样本太少算出来的数字只会误导人。练习卷每人题目不同，不做逐题分析。"
              />
            </Card>
          )}

          {isManager && (
            <Card id="proctor" style={{ marginBottom: 16 }}>
              <Title level={4} style={{ marginTop: 0 }}>
                <EyeOutlined /> 实时监考
              </Title>
              <Paragraph>
                考试进行到一半，最想知道的是「现在考场里什么情况」。试卷页「更多」里的
                <Text strong>实时监考</Text>就干这个：应考名单上每个人此刻什么状态，一眼看完。
              </Paragraph>
              <Space direction="vertical" size={6} style={{ marginBottom: 12 }}>
                <Text>
                  · 状态分五种：<Text strong>未开始 / 答题中 / 已暂停 / 已交卷 / 已超时</Text>，外加一个
                  <Text strong>掉线</Text>标记。
                </Text>
                <Text>
                  · <Text strong>在线判定</Text>：学生答题页每 20 秒发一次心跳，服务端超过 90 秒没收到就标掉线。
                </Text>
                <Text>
                  · <Text strong>掉线不等于作弊</Text>：绝大多数是网络断了、电脑休眠，或者学生把页面关了。
                  网络恢复后下一拍心跳就会自己回到「在线」，不用你手动处理。
                </Text>
                <Text>
                  · <Text strong>暂停中不判在线</Text>：学生自己点了暂停，显示「已暂停」，不计入掉线人数——
                  他人可能就坐在那儿。
                </Text>
                <Text>
                  · <Text strong>已答</Text>是每题选过选项的条数，白卷显示 0；<Text strong>剩余</Text>是这名学生自己的倒计时。
                </Text>
                <Text>
                  · <Text strong>成绩</Text>列在成绩没公布时显示「未公布」，不会显示 0 分。
                </Text>
              </Space>
              <Paragraph>
                页面每 10 秒自动刷新一次，右上角的开关可以关掉。名单上方能按状态筛（在看
                <Text strong>「掉线」</Text>就只列掉线的人），也能按班级筛、按姓名/学号搜。
              </Paragraph>
              <Paragraph>
                点某人的<Text strong>违规明细</Text>能看到他每一次切屏的时间与类型。判断是误报
                （比如按 F5 刷新、输入法候选框弹了一下、系统弹窗抢了焦点）就点<Text strong>撤销</Text>，
                可以顺手填个理由，事后翻记录能看到是谁、什么时候、为什么撤的。
              </Paragraph>
              <Alert
                type="warning"
                showIcon
                message="撤销不是删除，也不会改分数"
                description="记录会留着，只是标成「已撤销」并且不再占用三次额度——撤销一条，这名学生就重新获得一次机会。但如果他已经因为违规被强制交卷了，撤销不会把答卷退回答题状态，那种情况要在成绩册里另行处理。撤错了可以点「恢复」加回来。"
              />
            </Card>
          )}

          {isAdmin && (
            <Card id="audit" style={{ marginBottom: 16 }}>
              <Title level={4} style={{ marginTop: 0 }}>
                <AuditOutlined /> 审计日志
              </Title>
              <Paragraph>
                左侧导航最下面的<Text strong>「审计日志」</Text>回答同一类问题：<Text strong>这件事是谁干的？</Text>
                发布卷子、改分数开关、重置密码、撤销违规、导出成绩、清空题库——凡是会改变数据或把数据带出系统的动作，都会留一条记录。
              </Paragraph>
              <Space direction="vertical" size={6} style={{ marginBottom: 12 }}>
                <Text>
                  · 每条记录包含：<Text strong>时间、操作人（含当时的角色）、动作、对象、详情、来源 IP</Text>。
                </Text>
                <Text>
                  · <Text strong>名字是快照</Text>：账号后来改了名、甚至被删了，日志里仍然是当时那个名字——
                  不然「谁删的」这条线索会跟着账号一起消失。
                </Text>
                <Text>
                  · 分级三档：<Tag>日常</Tag> 量最大；<Tag color="orange">敏感</Tag> 涉及权限、成绩、导出；
                  <Tag color="red">高危</Tag> 是删数据、强制收卷、清理日志，出事之后先筛这一档。
                </Text>
                <Text>
                  · <Text strong>系统动作</Text>也记：到点自动收卷会写成「系统」，学生来问「我没交怎么是超时」时能对上时间。
                </Text>
                <Text>
                  · 按<Text strong>分类</Text>筛会同时把「动作」下拉收窄到该类，避免选出空组合；
                  按<Text strong>对象</Text>筛能拉出一份试卷从建立到归档的完整操作链。
                </Text>
                <Text>
                  · 带详情的那一行可以点开看完整 JSON，例如「status: active → disabled」。
                </Text>
              </Space>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="这里没有学生的答题流水"
                description="谁在什么时候开了考、交了什么答案，答卷表本身就有时间戳，翻「我的答卷」或成绩册更直接。审计日志只收管理动作，不然一学期下来几十万条答题记录会把真正要查的几条埋掉。"
              />
              <Alert
                type="warning"
                showIcon
                message="清理日志属于高危操作"
                description="清理会删掉指定时间点之前的全部记录，不可恢复；清理动作本身会留一条「清理审计日志」，而且这条永远删不掉。上级检查、校内申诉都可能倒查一年以前的操作，动手前先确认学校对留档期限的要求。"
              />
            </Card>
          )}

          <Card id="faq">
            <Title level={4} style={{ marginTop: 0 }}>
              常见问题
            </Title>
            <Collapse ghost items={FAQ} defaultActiveKey={['q1']} />
            <Divider />
            <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
              还有没解决的？把「做了什么操作、看到什么提示」告诉管理员，日志里一般能查到。
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
