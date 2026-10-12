唯一运行入口 scripts/yt.mjs，读取同目录 reference/workflow-protocol.json（运行时只消费其中列出的字段；编辑该文件即变更协议指纹）。项目根使用 COMET_RUN_ROOT 或 cwd。运行 help 查看接口；check 只读，advance 先检查再推进；协议变更后 migrate；验证循环超限后 decide。
