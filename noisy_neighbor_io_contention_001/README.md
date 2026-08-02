# 共享存储扰邻 Mock Case

该数据包遵循 Case V1.0 目录和字段规范，用于演示从受害者 Host-B 出发，先定位共享存储压力，再沿 `SHARES/ACCESSES` 关系反向发现施压者 Host-A 的诊断过程。

## 故障主线

`Host-A批处理I/O突增 → LUN-A吞吐/IOPS激增 → Controller-0A队列与Pool带宽饱和 → LUN-B时延升高 → Host-B交易业务变慢 → Host-A任务结束后恢复`

关键时间：

- 10:15:00：Host-A 批处理任务启动；
- 10:15:30：LUN-A IOPS 升至 165K；
- 10:16:00：共享控制器队列深度升至 186；
- 10:16:30：LUN-B 时延升至 42 ms；
- 10:19:00：Host-A 批处理结束；
- 10:20:00：共享压力与 Host-B 时延恢复。

本 Case 不新增扰邻专用 Skill；发现 Host-A 依赖拓扑查询、共享关系展开及多对象 KPI 时间对齐。所有数据均为 Mock 数据，不代表真实环境实测结果。
