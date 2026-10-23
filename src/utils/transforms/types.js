/**
 * 文本快捷转换规则类型契约与分类定义
 */

export const TRANSFORM_CATEGORIES = {
  CLEAN: 'clean',     // 消除报错与杂质（如终端提示符、断行、路径反斜杠）
  CONVERT: 'convert', // 结构与格式转换（如 JSON 单行/美化、时间戳、短 Hash）
  DECODE: 'decode',   // 编码解码还原（如 Unicode、URL 百分号乱码）
};
