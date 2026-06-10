import type { ToolName } from "@chengxiaobang/shared";
import type { ModelTool } from "../model/openai-compatible";

/**
 * OpenAI-style function definitions advertised to the model. Descriptions are in
 * Chinese to match the product surface and steer the model toward concrete,
 * workspace-relative actions.
 */
export const TOOL_DEFINITIONS: ModelTool[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "列出工作目录中某个目录的文件与子目录。用于了解项目结构。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的路径，默认当前目录 '.'" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取工作目录中某个文本文件的全部内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的文件路径" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "创建或覆盖工作目录中的一个文本文件，会自动创建所需的父目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的文件路径" },
          content: { type: "string", description: "要写入的完整文本内容" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "对已有文件做精确替换：把 oldText 第一次出现的位置替换为 newText。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的文件路径" },
          oldText: { type: "string", description: "需要被替换的原文（需在文件中唯一可定位）" },
          newText: { type: "string", description: "替换后的新文本" }
        },
        required: ["path", "oldText", "newText"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "make_directory",
      description: "在工作目录中创建一个目录（含多级父目录）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的目录路径" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "按通配符在工作目录中递归查找文件，例如 '**/*.ts' 或 'src/**/*.md'。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 通配符" }
        },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "在工作目录的文本文件中搜索包含指定字符串的行（不区分大小写）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "要搜索的文本" },
          path: { type: "string", description: "可选，限定搜索的子目录" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "抓取一个网页或接口的内容并返回纯文本，用于联网查资料、读取文档或 API 数据。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要抓取的 http(s) 地址" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "shell",
      description: "在工作目录中执行一条 shell 命令并返回输出。用于构建、安装依赖、运行脚本等。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "查看工作目录的 git 状态摘要。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "查看工作目录的 git 变更摘要与 diff 检查。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "create_pptx",
      description:
        "根据结构化的 deck 规格生成一个真正的 .pptx 演示文稿文件并写入工作目录。优先使用本工具来“做 PPT / 制作幻灯片”。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "输出文件路径，需以 .pptx 结尾" },
          deck: {
            type: "object",
            description: "演示文稿规格",
            properties: {
              title: { type: "string" },
              subtitle: { type: "string" },
              author: { type: "string" },
              theme: {
                type: "object",
                properties: {
                  primary: { type: "string", description: "主色，十六进制如 2E5BFF" },
                  accent: { type: "string" },
                  background: { type: "string" },
                  text: { type: "string" }
                }
              },
              slides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    layout: {
                      type: "string",
                      enum: ["title", "section", "bullets", "content", "two-column", "quote"]
                    },
                    title: { type: "string" },
                    subtitle: { type: "string" },
                    bullets: { type: "array", items: { type: "string" } },
                    paragraphs: { type: "array", items: { type: "string" } },
                    columns: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          bullets: { type: "array", items: { type: "string" } }
                        }
                      }
                    },
                    quote: { type: "string" },
                    attribution: { type: "string" },
                    notes: { type: "string" }
                  }
                }
              }
            }
          }
        },
        required: ["path", "deck"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_docx",
      description:
        "根据结构化的文档规格生成一个真正的 .docx Word 文档并写入工作目录。用于“写文档 / 生成报告 / Word”。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "输出文件路径，需以 .docx 结尾" },
          document: {
            type: "object",
            properties: {
              title: { type: "string" },
              subtitle: { type: "string" },
              blocks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["heading", "paragraph", "bullets", "ordered", "quote"]
                    },
                    level: { type: "number", description: "标题级别 1-4" },
                    text: { type: "string" },
                    items: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        },
        required: ["path", "document"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_xlsx",
      description:
        "根据结构化的工作簿规格生成一个真正的 .xlsx Excel 表格并写入工作目录。用于“做表格 / 数据整理 / Excel”。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "输出文件路径，需以 .xlsx 结尾" },
          workbook: {
            type: "object",
            properties: {
              sheets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "工作表名称" },
                    columns: {
                      type: "array",
                      description: "列定义（带表头）",
                      items: {
                        type: "object",
                        properties: {
                          header: { type: "string" },
                          key: { type: "string" },
                          width: { type: "number" }
                        },
                        required: ["header"]
                      }
                    },
                    rows: {
                      type: "array",
                      description:
                        "数据行；每行可以是数组（按列顺序）或对象（以列 key 为字段）",
                      items: {}
                    }
                  }
                }
              }
            }
          }
        },
        required: ["path", "workbook"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "feishu_send_message",
      description:
        "将一条文本消息主动发送到飞书群聊或私聊。需要用户已在设置中配置并启用飞书机器人。",
      parameters: {
        type: "object",
        properties: {
          chatId: {
            type: "string",
            description: "飞书会话 chat_id（通常以 oc_ 开头）"
          },
          content: { type: "string", description: "要发送的文本内容" }
        },
        required: ["chatId", "content"]
      }
    }
  }
];

const MUTATING_TOOLS = new Set<ToolName>([
  "write_file",
  "edit_file",
  "make_directory",
  "shell",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  // Outbound messaging needs consent too — and being approval-gated means
  // read-only Feishu-triggered runs can never spam Feishu themselves.
  "feishu_send_message"
]);

export function requiresApproval(name: ToolName): boolean {
  return MUTATING_TOOLS.has(name);
}
