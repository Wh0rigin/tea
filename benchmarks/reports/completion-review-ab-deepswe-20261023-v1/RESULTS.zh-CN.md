# S7 完成前复核：DeepSWE 对照

## 结论

**尚未证明 S7 有效，不启用默认开关。** 四次候选均未触发完成前复核：三次在复核前因流式解析异常失败，最后一次因未解决的广泛验证失败而止于 `needs_validation`。本轮不能把结果变化归因于 S7。

## 结果

- 官方整题通过：1/4 → 1/4。
- Agent 正常完成：1/4 → 0/4。
- 全部尝试累计 Token：unknown → unknown；节省 unknown，负值表示增加。
- 双方通过、正常完成且用量完整的配对：0/4，节省 unknown。

## 对照条件

两道此前已测过的 DeepSWE 题 Helm/Mnamer，每题两次配对，交错 AB/BA 串行运行。两边同一份 c83be7a 源码，仅 completionReview 关闭/开启不同。working-set 均关闭，均使用当前 CLI Pi 上下文预算机制，不能拿旧版固定输出预留的历史数据替代本轮基线。官方 GLM-5.3-flash，enabled/low、8000 思考预算、流式，输出最大 131072、上下文 216000；当前 Pi 策略按可用窗口拟合输出。协议付费前冻结于 071a03c。

每次 10 USD 等值控制额度、合计80；最多128次请求、单请求900秒、Agent1800秒。它是保守控制而非实际账单。未知保留额度且不自动重试。所有失败真实用量保留，未知不按零计；思考输出只计入output一次。Pi/Claude未重测。

## 配对结果

- helm-unified-manifest-stream / 组1：通过 True→False；状态 cancelled→failed；Token 3,431,785→unknown；节省 unknown。
- helm-unified-manifest-stream / 组2：通过 False→False；状态 cancelled→failed；Token unknown→unknown；节省 unknown。
- mnamer-daemon-watch-lifecycle / 组1：通过 False→False；状态 failed→failed；Token unknown→unknown；节省 unknown。
- mnamer-daemon-watch-lifecycle / 组2：通过 False→True；状态 completed→needs_validation；Token 502,077→1,459,720；节省 -190.74%。

## 机制检查与局限

- helm-unified-manifest-stream / repeat1 / baseline：完成前复核触发 0 次。
- helm-unified-manifest-stream / repeat2 / candidate：完成前复核触发 0 次。
- mnamer-daemon-watch-lifecycle / repeat2 / candidate：完成前复核触发 0 次。
- mnamer-daemon-watch-lifecycle / repeat1 / baseline：完成前复核触发 0 次。
- helm-unified-manifest-stream / repeat4 / candidate：完成前复核触发 0 次。
- helm-unified-manifest-stream / repeat3 / baseline：完成前复核触发 0 次。
- mnamer-daemon-watch-lifecycle / repeat3 / baseline：完成前复核触发 0 次。
- mnamer-daemon-watch-lifecycle / repeat4 / candidate：完成前复核触发 0 次。

正确率优先的筛选检查：{'officialAcceptanceNotWorse': True, 'nativeCompletionNotWorse': False, 'allCandidateP2PPreserved': True, 'eightMetered': False, 'mechanismActivated': False}。复核不保证语义完整；触发后仍需看正式验收。两道已见题不能证明泛化，供应商缓存和生成随机性仍可能影响用量。默认保持关闭，等待审核；无需因Token下降而接受正确率退化。详细用量、验收和失败项见results.json与diagnostics.json。未读取模型私有思维过程或隐藏判定器实现。

## 已观察到的成本与失败原因

1. 共提交 **322 次**模型请求，317次用量完整、5次不完整。四次中断为不可解析的流式JSON，均HTTP200但没有有效结束事件；另一次在Agent到时时取消，流也未完整结束。不能根据HTTP200推定调用成功，不能将部分用量中的零字段当作完整用量。3/8次尝试具有完整总量，已知Token下界为10,474,398；它不是完整总量，也不用于计算总体节省。
2. 所有同题初始请求的SHA-256完全相同，初始提示词、工具和任务未因开关而变化。四次候选的原生ledger复核事件都为0。差异发生在S7介入之前，因此随机生成轨迹、调用异常和已有工作流共同限制了因果判断。
3. 唯一双方用量完整的配对是Mnamer第二组：502,077→1,459,720 Token，**增加190.74%**；官方369/370→370/370，基线正常完成、候选needs_validation。它不是同质量效率配对，不能宣传成节省，也不能说额外消耗由尚未触发的复核造成。
4. 此配对工具操作40→86、模型请求27→63。候选运行13次测试，其中 `pytest tests -q -k "not network"` 重复5次、带`-x`版本重复3次，专项测试运行5次。专项最终25/25通过，但原广泛命令仍失败；输出包含OMDb等测试的`network error`信号。`-k "not network"`只筛选名称，未实际排除全部联网测试。没有基线隔离证据，不把所有广泛失败一概认定为环境问题。
5. 同配对非缓存输入396,311→771,984，缓存读取87,296→665,600，输出18,470→22,136。957,643个增量Token中，缓存读取增加578,304，约占60.4%；重复请求的累计输入流量是主要增长项，不能仅看输出长度。
6. 两次Helm基线分别在第70次工具操作首次编辑、累计109次工具操作仍未编辑而到时。第二次发生1次自动压缩并回收历史，但没有进入源码修改。这个长检索问题位于完成前复核之前，S7当前不处理它。
7. Mnamer正常完成的基线仍漏掉`test_daemon_logs_respects_state_path_with_subdirectory`，再次显示自测全通过不代表契约完整。候选370/370通过是实际结果，但复核没有运行，不能把该单题变化归功于S7。双方“正常完成且官方整题通过”的尝试均为0/4。

## 下一步建议（未实现、未启动新付费调用）

- 优先诊断流式帧异常：记录脱敏结构元数据和哈希，使用离线重放区分解析兼容性、传输和服务端问题。不盲目跳过坏JSON，不对未知计费自动重试。
- 调整完成复核触发位置：即使存在待验证项，也允许一次需求覆盖复核；复核不清空失败，不把任务改成已验证完成。当前必须先清除pendingValidation的门槛在真实任务中阻止了机制执行。
- 对相同源码版本、相同失败指纹的无进展重复验证建立停止条件；先定位单项失败，必要时在隔离的原始版本验证基线。区分环境受阻和新增缺陷，保留未验证项，不能简单放宽验收。
- 对长检索建立证据进展检查，优先复用已有证据并缩小剩余问题；不能为节省Token强迫模型在证据不足时编辑。
- 上述问题修复后重新冻结同期对照，保留本轮所有失败。先确保机制实际触发、验收不退化，再讨论Token收益及未见题泛化。

## 完整性说明

源码归档50个文件逐一匹配c83be7a的Git原始blob；两组使用相同归档。322个客户端请求与传输记录的数量、哈希、已报告用量和模型控制条件均匹配；未知请求仍保留为未知。8次初始源码版本与任务指令哈希匹配，配置开关均正确。协议公开文件为Git的LF形式，执行时CRLF原件另存；两种哈希分别记录于verification.json，规范化后完全一致。没有修改协议字段或补跑失败样本。

所有控制进程已退出，本轮不再提交模型请求。50 USD未知额度预留保留在原记录中，它不是实际账单。Pi和Claude均未重测。源码本轮未变更，先前专项18/18、完整回归467通过/1跳过/0失败仍为该运行版本的离线测试证据。
