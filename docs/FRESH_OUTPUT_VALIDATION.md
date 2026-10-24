# Fresh output validation guidance (candidate)

## Scope

This candidate replaces the existing entry-point verification paragraph in `src/prompts.mjs`. It asks the agent to use fresh inputs, test missing output parents, keep product-owned output setup out of fixtures, and preserve dry-run/read-only behavior. Existing requirement mapping, observable results, background lifetime checks and post-edit validation remain.

The paragraph grows from 47 to 54 whitespace-separated English words, or 294 to 370 characters (+76). These are offline text lengths, not provider tokens. It adds no mandatory review round, new tool, path classifier or automatic directory creation. The model still chooses relevant checks according to the task's contract; some products legitimately reject a missing parent instead of creating it. Read-only inspection does not acquire permission to create outputs.

The complete PR16 model/context configuration and production command policy remain unchanged. This does not include the PR19 requirement-review trigger or the separate proposed handling of unsupported test-runner arguments.

## Verification and limitations

`tests/fresh-output-guidance.test.mjs` checks conditional guidance, unique insertion and absence of benchmark names or prescribed repair APIs. A self-authored Node CLI fixture demonstrates independent entry-point validation:

- A missing nested output parent exposes a broken implementation; repairing the product, without preparing its output directory in the fixture, makes the same scenario pass.
- Existing output parents remain supported.
- Dry-run leaves missing output directories/files absent.
- Read-only log queries leave missing output parents absent.
- A regular file used as a parent produces failure without replacing that file or changing the input.

These child processes are real, but their implementation and repair are scripted by the test author. They do not establish autonomous model behavior, DeepSWE acceptance, or a token improvement. The paid production screen motivating the change is recorded in [PR23](https://github.com/Wh0rigin/tea/pull/23); this candidate requires its own frozen comparison before any quality or token claim.

## 中文说明

本候选只替换现有验证提示段落：用全新输入和缺失父目录的输出路径验证真实入口，测试准备不代办产品应完成的输出，并保留 dry-run/只读语义。路径错误的预期结果应遵守任务约定，不是一律要求产品自动创建目录。

没有增加固定收尾复核、工具调用或目录创建逻辑，也没有改动 PR16 参数、命令权限或验证完成判定。新增测试使用自编 CLI，能证明测试方法发现缺陷，不能证明模型正确率或真实 Token 已改善。提示段落增加 7 个英文单词、76 个字符；这不是 Token 测量。
