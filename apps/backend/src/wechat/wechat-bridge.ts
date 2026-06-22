import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import type {
  ConnectPhoneInstallStartResult,
  WechatConfig
} from "@chengxiaobang/shared";
import wechatPackageJson from "@tencent-weixin/openclaw-weixin/package.json";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "wechat/wechat-bridge" });

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WechatInstallPollResult =
  | {
      done: true;
      accountId: string;
      sessionKey: string;
      userId?: string;
    }
  | {
      done: false;
      error?: string;
    };

export interface WechatInboundMessage {
  chatId: string;
  messageId: string;
  messageType: "text" | "unsupported";
  text?: string;
  senderName?: string;
}

export interface WechatBridge {
  startInstall(): Promise<ConnectPhoneInstallStartResult>;
  pollInstall(deviceCode: string): Promise<WechatInstallPollResult>;
  start(accountId: string, onMessage: (message: WechatInboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  sendText(chatId: string, content: string): Promise<void>;
}

type WechatPackageInfo = {
  version: string;
  appId: string;
};

type WechatLoginSession = {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  currentApiBaseUrl?: string;
};

type WechatAccountData = {
  token?: string;
  baseUrl?: string;
  userId?: string;
};

type WechatAccount = {
  accountId: string;
  baseUrl: string;
  token?: string;
  configured: boolean;
  userId?: string;
};

type WechatMessageItem = {
  type?: number;
  text_item?: { text?: unknown };
  voice_item?: { text?: unknown };
};

type WechatRemoteMessage = {
  message_id?: unknown;
  message_type?: unknown;
  from_user_id?: unknown;
  context_token?: unknown;
  item_list?: unknown;
};

type WechatMonitor = {
  accountId: string;
  controller: AbortController;
  promise: Promise<void>;
};

const WECHAT_PLUGIN_ID = "openclaw-weixin";
const WECHAT_API_BASE_URL = "https://ilinkai.weixin.qq.com";
const WECHAT_DEFAULT_BOT_TYPE = "3";
const LOGIN_TTL_MS = 5 * 60_000;
const QR_VISIBLE_TTL_SECONDS = 120;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MessageType = {
  BOT: 2
} as const;
const MessageItemType = {
  TEXT: 1
} as const;
const MessageState = {
  FINISH: 2
} as const;

export class WechatBridgeRuntime implements WechatBridge {
  private readonly fetchImpl: FetchLike;
  private readonly stateDir: string;
  private readonly activeLogins = new Map<string, WechatLoginSession>();
  private readonly contextTokens = new Map<string, string>();
  private readonly monitors = new Map<string, WechatMonitor>();
  private packageInfoCache?: WechatPackageInfo;

  constructor(options: { dataDir: string; fetch?: FetchLike }) {
    this.fetchImpl = options.fetch ?? fetch;
    this.stateDir = join(options.dataDir, "wechat-bridge", WECHAT_PLUGIN_ID);
  }

  async startInstall(): Promise<ConnectPhoneInstallStartResult> {
    log.info("[wechat-bridge] 开始生成微信扫码连接");
    try {
      this.readPackageInfo();
      this.purgeExpiredLogins();
      const qr = await this.fetchQrCode();
      const qrcode = recordString(qr, "qrcode");
      const qrcodeUrl =
        recordString(qr, "qrcode_img_content") ||
        recordString(qr, "qrcodeUrl") ||
        recordString(qr, "qrDataUrl") ||
        recordString(qr, "qrUrl");
      if (!qrcode || !qrcodeUrl) {
        throw new Error(recordString(qr, "message") || "微信二维码响应不完整");
      }
      const deviceCode = randomUUID();
      this.activeLogins.set(deviceCode, {
        sessionKey: deviceCode,
        qrcode,
        qrcodeUrl,
        startedAt: Date.now()
      });
      log.info("[wechat-bridge] 微信扫码连接已生成", {
        deviceCodePrefix: shortId(deviceCode),
        expiresIn: QR_VISIBLE_TTL_SECONDS
      });
      return {
        ok: true,
        target: "wechat",
        url: qrcodeUrl,
        deviceCode,
        userCode: "",
        interval: 3,
        expiresIn: QR_VISIBLE_TTL_SECONDS
      };
    } catch (error) {
      const message = errorMessage(error);
      log.warn("[wechat-bridge] 生成微信扫码连接失败", { error: message });
      return { ok: false, target: "wechat", message };
    }
  }

  async pollInstall(deviceCode: string): Promise<WechatInstallPollResult> {
    const key = deviceCode.trim();
    const login = this.activeLogins.get(key);
    if (!login) {
      log.warn("[wechat-bridge] 微信扫码轮询失败，deviceCode 不存在", {
        deviceCodePrefix: shortId(key)
      });
      return { done: false, error: "扫码状态已过期，请重新生成二维码" };
    }
    if (!this.isLoginFresh(login)) {
      this.activeLogins.delete(key);
      log.info("[wechat-bridge] 微信二维码已过期", { deviceCodePrefix: shortId(key) });
      return { done: false, error: "二维码已过期，请重新生成" };
    }

    const status = await this.pollQrStatus(login.currentApiBaseUrl ?? WECHAT_API_BASE_URL, login.qrcode);
    const statusText = recordString(status, "status");
    log.debug("[wechat-bridge] 微信扫码状态轮询完成", {
      deviceCodePrefix: shortId(key),
      status: statusText || "empty"
    });

    switch (statusText) {
      case "wait":
      case "scaned":
        return { done: false };
      case "need_verifycode":
        this.activeLogins.delete(key);
        return {
          done: false,
          error: "微信要求输入手机端验证码。当前连接流程暂不支持验证码，请重新生成二维码后再试。"
        };
      case "expired":
        this.activeLogins.delete(key);
        return { done: false, error: "二维码已过期，请重新生成" };
      case "verify_code_blocked":
        this.activeLogins.delete(key);
        return { done: false, error: "多次输入错误，连接流程已停止。请稍后再试。" };
      case "scaned_but_redirect": {
        const redirectHost = recordString(status, "redirect_host");
        if (redirectHost) {
          login.currentApiBaseUrl = `https://${redirectHost}`;
        }
        return { done: false };
      }
      case "binded_redirect": {
        this.activeLogins.delete(key);
        const hintedAccountId =
          recordString(status, "ilink_bot_id") ||
          recordString(status, "bot_id") ||
          recordString(status, "account_id");
        const account = await this.findConfiguredAccount(hintedAccountId);
        if (!account) {
          log.warn("[wechat-bridge] 微信账号已绑定但本地缺少可用授权信息", {
            deviceCodePrefix: shortId(key),
            hintedAccountId: hintedAccountId || undefined
          });
          return {
            done: false,
            error: "微信账号已绑定，但本地授权信息不可用，请重新扫码连接。"
          };
        }
        log.info("[wechat-bridge] 微信账号已绑定过当前连接，复用本地授权账号", {
          accountId: account.accountId,
          hintedAccountId: hintedAccountId || undefined
        });
        return {
          done: true,
          accountId: account.accountId,
          sessionKey: login.sessionKey,
          ...(account.userId ? { userId: account.userId } : {})
        };
      }
      case "confirmed":
        return this.finishConfirmedLogin(key, login, status);
      default:
        return { done: false };
    }
  }

  async start(accountId: string, onMessage: (message: WechatInboundMessage) => void): Promise<void> {
    const requestedAccountId = normalizeAccountId(accountId);
    let account = await this.resolveAccount(requestedAccountId);
    if (!account.configured || !account.token) {
      const fallback = await this.findConfiguredAccount();
      if (fallback && fallback.accountId !== requestedAccountId) {
        log.warn("[wechat-bridge] 微信配置账号缺少 token，改用本地已授权账号启动轮询", {
          requestedAccountId,
          accountId: fallback.accountId
        });
        account = fallback;
      }
    }
    if (!account.configured || !account.token) {
      throw new Error("微信账号未配置，请重新扫码连接");
    }
    const activeAccountId = account.accountId;
    const existing = this.monitors.get(activeAccountId);
    if (existing && !existing.controller.signal.aborted) {
      log.info("[wechat-bridge] 微信消息轮询已在运行", { accountId: activeAccountId });
      return;
    }
    const controller = new AbortController();
    const promise = this.monitorAccount(account, onMessage, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          log.error("[wechat-bridge] 微信消息轮询已停止", {
            accountId: activeAccountId,
            error: errorMessage(error)
          });
        }
      })
      .finally(() => {
        if (this.monitors.get(activeAccountId)?.controller === controller) {
          this.monitors.delete(activeAccountId);
        }
      });
    this.monitors.set(activeAccountId, { accountId: activeAccountId, controller, promise });
    log.info("[wechat-bridge] 微信消息轮询已启动", { accountId: activeAccountId });
  }

  async stop(): Promise<void> {
    const monitors = [...this.monitors.values()];
    this.monitors.clear();
    for (const monitor of monitors) {
      monitor.controller.abort();
    }
    await Promise.allSettled(monitors.map((monitor) => monitor.promise));
    log.info("[wechat-bridge] 微信消息轮询已全部停止", { count: monitors.length });
  }

  async sendText(chatId: string, content: string): Promise<void> {
    const text = content.trim();
    if (!text) {
      return;
    }
    const accountId = this.firstActiveAccountId();
    if (!accountId) {
      throw new Error("微信连接未启动，无法发送消息");
    }
    const account = await this.resolveAccount(accountId);
    if (!account.configured || !account.token) {
      throw new Error("微信账号未配置，无法发送消息");
    }
    await this.sendMessage(account, chatId, text);
  }

  private async finishConfirmedLogin(
    deviceCode: string,
    login: WechatLoginSession,
    status: JsonRecord
  ): Promise<WechatInstallPollResult> {
    const rawAccountId = recordString(status, "ilink_bot_id");
    const token = recordString(status, "bot_token");
    if (!rawAccountId || !token) {
      this.activeLogins.delete(deviceCode);
      log.warn("[wechat-bridge] 微信扫码确认后缺少账号或 token", {
        hasAccountId: Boolean(rawAccountId),
        hasToken: Boolean(token)
      });
      return { done: false, error: "登录失败：微信未返回完整账号信息。" };
    }
    const accountId = normalizeAccountId(rawAccountId);
    const baseUrl = recordString(status, "baseurl") || WECHAT_API_BASE_URL;
    const userId = recordString(status, "ilink_user_id");
    await this.saveAccount(accountId, { token, baseUrl, userId });
    await this.clearStaleAccountsForUserId(accountId, userId);
    this.activeLogins.delete(deviceCode);
    log.info("[wechat-bridge] 微信扫码授权成功", {
      accountId,
      userId: userId || undefined
    });
    return {
      done: true,
      accountId,
      sessionKey: login.sessionKey,
      ...(userId ? { userId } : {})
    };
  }

  private async monitorAccount(
    account: WechatAccount,
    onMessage: (message: WechatInboundMessage) => void,
    signal: AbortSignal
  ): Promise<void> {
    let syncBuf = await this.loadSyncBuf(account.accountId);
    let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;
    while (!signal.aborted) {
      try {
        const response = await this.getUpdates(account, syncBuf, nextTimeoutMs);
        if (typeof response.longpolling_timeout_ms === "number" && response.longpolling_timeout_ms > 0) {
          nextTimeoutMs = response.longpolling_timeout_ms;
        }
        const ret = Number(response.ret ?? 0);
        const errcode = Number(response.errcode ?? 0);
        if (ret !== 0 || errcode !== 0) {
          consecutiveFailures += 1;
          log.warn("[wechat-bridge] 微信消息轮询返回非成功状态", {
            accountId: account.accountId,
            ret,
            errcode,
            consecutiveFailures
          });
          await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
          if (consecutiveFailures >= 3) {
            consecutiveFailures = 0;
          }
          continue;
        }
        consecutiveFailures = 0;
        const nextBuf = typeof response.get_updates_buf === "string" ? response.get_updates_buf : "";
        const messages = Array.isArray(response.msgs) ? (response.msgs as WechatRemoteMessage[]) : [];
        for (const message of messages) {
          try {
            if (signal.aborted) {
              return;
            }
            const messageRecord = asRecord(message);
            if (recordNumber(messageRecord, "message_type") === MessageType.BOT) {
              continue;
            }
            const inbound = this.toInboundMessage(account.accountId, messageRecord);
            if (!inbound.chatId) {
              log.warn("[wechat-bridge] 跳过缺少发送人的微信消息", {
                accountId: account.accountId,
                messageId: recordScalarString(messageRecord, "message_id") || undefined
              });
              continue;
            }
            const contextToken = recordScalarString(messageRecord, "context_token");
            if (contextToken) {
              this.contextTokens.set(contextTokenKey(account.accountId, inbound.chatId), contextToken);
              await this.persistContextTokens(account.accountId);
            }
            log.info("[wechat-bridge] 收到微信消息", {
              accountId: account.accountId,
              chatId: inbound.chatId,
              messageId: inbound.messageId,
              messageType: inbound.messageType
            });
            onMessage(inbound);
          } catch (error) {
            log.warn("[wechat-bridge] 解析单条微信消息失败，已跳过", {
              accountId: account.accountId,
              error: errorMessage(error)
            });
          }
        }
        if (nextBuf) {
          syncBuf = nextBuf;
          await this.saveSyncBuf(account.accountId, syncBuf);
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        consecutiveFailures += 1;
        log.warn("[wechat-bridge] 微信消息轮询异常，将重试", {
          accountId: account.accountId,
          error: errorMessage(error),
          consecutiveFailures
        });
        await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        if (consecutiveFailures >= 3) {
          consecutiveFailures = 0;
        }
      }
    }
  }

  private toInboundMessage(accountId: string, message: JsonRecord): WechatInboundMessage {
    const chatId = recordScalarString(message, "from_user_id");
    const text = textFromTextItem(message.item_list);
    return {
      chatId,
      messageId: recordScalarString(message, "message_id") || `wechat-${randomUUID()}`,
      messageType: text ? "text" : "unsupported",
      ...(text ? { text } : {}),
      senderName: chatId || accountId
    };
  }

  private async fetchQrCode(): Promise<JsonRecord> {
    return this.apiPost(
      WECHAT_API_BASE_URL,
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_DEFAULT_BOT_TYPE)}`,
      { local_token_list: await this.localTokenList() },
      { label: "fetchQRCode" }
    );
  }

  private async pollQrStatus(baseUrl: string, qrcode: string): Promise<JsonRecord> {
    try {
      return await this.apiGet(
        baseUrl,
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        QR_LONG_POLL_TIMEOUT_MS,
        "pollQRStatus"
      );
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { status: "wait" };
      }
      log.warn("[wechat-bridge] 微信二维码状态轮询失败，按等待处理", {
        error: errorMessage(error)
      });
      return { status: "wait" };
    }
  }

  private async getUpdates(
    account: WechatAccount,
    syncBuf: string,
    timeoutMs: number
  ): Promise<JsonRecord> {
    try {
      return await this.apiPost(
        account.baseUrl,
        "ilink/bot/getupdates",
        {
          get_updates_buf: syncBuf,
          base_info: this.buildBaseInfo()
        },
        { token: account.token, timeoutMs, label: "getUpdates" }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { ret: 0, msgs: [], get_updates_buf: syncBuf };
      }
      throw error;
    }
  }

  private async sendMessage(account: WechatAccount, chatId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(contextTokenKey(account.accountId, chatId));
    const clientId = `chengxiaobang-wechat-${randomUUID()}`;
    await this.apiPost(
      account.baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: chatId,
          client_id: clientId,
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
          context_token: contextToken
        },
        base_info: this.buildBaseInfo()
      },
      { token: account.token, timeoutMs: DEFAULT_API_TIMEOUT_MS, label: "sendMessage" }
    );
    log.info("[wechat-bridge] 已发送微信文本消息", {
      accountId: account.accountId,
      chatId,
      clientId,
      chars: text.length
    });
  }

  private async apiGet(
    baseUrl: string,
    endpoint: string,
    timeoutMs: number,
    label: string
  ): Promise<JsonRecord> {
    const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: this.buildCommonHeaders(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`${label} ${response.status}: ${recordString(data, "message") || JSON.stringify(data)}`);
    }
    return data;
  }

  private async apiPost(
    baseUrl: string,
    endpoint: string,
    body: JsonRecord,
    options: { token?: string; timeoutMs?: number; label: string }
  ): Promise<JsonRecord> {
    const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: this.buildHeaders(options.token),
      body: JSON.stringify(body),
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`${options.label} ${response.status}: ${recordString(data, "message") || JSON.stringify(data)}`);
    }
    return data;
  }

  private readPackageInfo(): WechatPackageInfo {
    if (this.packageInfoCache) {
      return this.packageInfoCache;
    }
    const packageJson = wechatPackageJson as { version?: string; ilink_appid?: string };
    this.packageInfoCache = {
      version: packageJson.version ?? "0.0.0",
      appId: packageJson.ilink_appid ?? "bot"
    };
    return this.packageInfoCache;
  }

  private buildClientVersion(): number {
    const { version } = this.readPackageInfo();
    const [major = 0, minor = 0, patch = 0] = version
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
    return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
  }

  private buildBaseInfo(): JsonRecord {
    const info = this.readPackageInfo();
    return {
      channel_version: info.version,
      bot_agent: "Chengxiaobang/0.1.11"
    };
  }

  private buildCommonHeaders(): Record<string, string> {
    const info = this.readPackageInfo();
    return {
      "iLink-App-Id": info.appId,
      "iLink-App-ClientVersion": String(this.buildClientVersion())
    };
  }

  private buildHeaders(token?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
      ...this.buildCommonHeaders(),
      ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {})
    };
  }

  private async localTokenList(): Promise<string[]> {
    const tokens: string[] = [];
    for (const accountId of await this.listAccountIds()) {
      const data = await this.loadAccountData(accountId);
      if (data?.token?.trim()) {
        tokens.push(data.token.trim());
      }
      if (tokens.length >= 10) {
        break;
      }
    }
    return tokens;
  }

  private async findConfiguredAccount(preferredAccountId?: string): Promise<WechatAccount | undefined> {
    const ids = new Set<string>();
    if (preferredAccountId?.trim()) {
      ids.add(normalizeAccountId(preferredAccountId));
    }
    for (const accountId of await this.listAccountIds()) {
      ids.add(accountId);
    }
    for (const accountId of ids) {
      const account = await this.resolveAccount(accountId);
      if (account.configured && account.token) {
        return account;
      }
    }
    return undefined;
  }

  private firstActiveAccountId(): string | undefined {
    return [...this.monitors.keys()][0];
  }

  private accountsDir(): string {
    return join(this.stateDir, "accounts");
  }

  private accountsIndexPath(): string {
    return join(this.stateDir, "accounts.json");
  }

  private accountPath(accountId: string): string {
    return join(this.accountsDir(), `${accountId}.json`);
  }

  private syncBufPath(accountId: string): string {
    return join(this.accountsDir(), `${accountId}.sync.json`);
  }

  private contextTokensPath(accountId: string): string {
    return join(this.accountsDir(), `${accountId}.context-tokens.json`);
  }

  private async ensureStateDirs(): Promise<void> {
    await mkdir(this.accountsDir(), { recursive: true });
  }

  private async listAccountIds(): Promise<string[]> {
    try {
      const parsed = await readJsonFile(this.accountsIndexPath());
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string" && value.trim() !== "")
        : [];
    } catch {
      return [];
    }
  }

  private async registerAccountId(accountId: string): Promise<void> {
    await this.ensureStateDirs();
    const existing = await this.listAccountIds();
    if (existing.includes(accountId)) {
      return;
    }
    await writeJsonIfChanged(this.accountsIndexPath(), [...existing, accountId]);
  }

  private async unregisterAccountId(accountId: string): Promise<void> {
    const existing = await this.listAccountIds();
    const next = existing.filter((id) => id !== accountId);
    if (next.length !== existing.length) {
      await writeJsonIfChanged(this.accountsIndexPath(), next);
    }
  }

  private async loadAccountData(accountId: string): Promise<WechatAccountData | null> {
    try {
      const parsed = await readJsonFile(this.accountPath(accountId));
      return asRecord(parsed) as WechatAccountData;
    } catch {
      return null;
    }
  }

  private async saveAccount(accountId: string, update: WechatAccountData): Promise<void> {
    await this.ensureStateDirs();
    const existing = (await this.loadAccountData(accountId)) ?? {};
    const token = update.token?.trim() || existing.token?.trim();
    const baseUrl = update.baseUrl?.trim() || existing.baseUrl?.trim();
    const userId = update.userId !== undefined
      ? update.userId.trim() || undefined
      : existing.userId?.trim() || undefined;
    await writeJsonIfChanged(this.accountPath(accountId), {
      ...(token ? { token, savedAt: new Date().toISOString() } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(userId ? { userId } : {})
    });
    await this.registerAccountId(accountId);
  }

  private async clearAccount(accountId: string): Promise<void> {
    for (const filePath of [
      this.accountPath(accountId),
      this.syncBufPath(accountId),
      this.contextTokensPath(accountId)
    ]) {
      try {
        await unlink(filePath);
      } catch {
        // 删除旧账号状态失败不影响当前登录。
      }
    }
    await this.unregisterAccountId(accountId);
  }

  private async clearStaleAccountsForUserId(currentAccountId: string, userId: string): Promise<void> {
    if (!userId.trim()) {
      return;
    }
    for (const accountId of await this.listAccountIds()) {
      if (accountId === currentAccountId) {
        continue;
      }
      const data = await this.loadAccountData(accountId);
      if (data?.userId?.trim() === userId) {
        await this.clearAccount(accountId);
      }
    }
  }

  private async resolveAccount(accountId: string): Promise<WechatAccount> {
    const normalized = normalizeAccountId(accountId);
    const data = await this.loadAccountData(normalized);
    const token = data?.token?.trim();
    await this.restoreContextTokens(normalized);
    return {
      accountId: normalized,
      baseUrl: data?.baseUrl?.trim() || WECHAT_API_BASE_URL,
      token,
      configured: Boolean(token),
      userId: data?.userId?.trim() || undefined
    };
  }

  private async loadSyncBuf(accountId: string): Promise<string> {
    try {
      const parsed = await readJsonFile(this.syncBufPath(accountId));
      return recordString(asRecord(parsed), "buf");
    } catch {
      return "";
    }
  }

  private async saveSyncBuf(accountId: string, buf: string): Promise<void> {
    await writeJsonIfChanged(this.syncBufPath(accountId), { buf });
  }

  private async persistContextTokens(accountId: string): Promise<void> {
    const prefix = `${accountId}:`;
    const tokens: Record<string, string> = {};
    for (const [key, value] of this.contextTokens) {
      if (key.startsWith(prefix)) {
        tokens[key.slice(prefix.length)] = value;
      }
    }
    await writeJsonIfChanged(this.contextTokensPath(accountId), tokens);
  }

  private async restoreContextTokens(accountId: string): Promise<void> {
    try {
      const parsed = asRecord(await readJsonFile(this.contextTokensPath(accountId)));
      for (const [chatId, token] of Object.entries(parsed)) {
        if (typeof token === "string" && token.trim()) {
          this.contextTokens.set(contextTokenKey(accountId, chatId), token.trim());
        }
      }
    } catch {
      // 首次启动没有上下文 token 文件是正常情况。
    }
  }

  private isLoginFresh(login: WechatLoginSession): boolean {
    return Date.now() - login.startedAt < LOGIN_TTL_MS;
  }

  private purgeExpiredLogins(): void {
    for (const [key, login] of this.activeLogins) {
      if (!this.isLoginFresh(login)) {
        this.activeLogins.delete(key);
      }
    }
  }
}

export function wechatConfigFromInstall(result: {
  accountId: string;
  sessionKey: string;
  userId?: string;
}): WechatConfig {
  return {
    enabled: true,
    accountId: result.accountId,
    sessionKey: result.sessionKey,
    ...(result.userId ? { userId: result.userId } : {})
  };
}

async function readJsonResponse(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    return { message: text.trim() || response.statusText };
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const current = await readFile(filePath, "utf8");
    if (current === next) {
      return;
    }
  } catch {
    // 文件不存在时继续创建。
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, next, "utf8");
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function recordString(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function recordScalarString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function recordNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function textFromTextItem(itemList: unknown): string {
  if (!Array.isArray(itemList)) {
    return "";
  }
  for (const item of itemList) {
    const record = asRecord(item);
    if (recordNumber(record, "type") === MessageItemType.TEXT) {
      const text = asRecord(record.text_item).text;
      return text === undefined || text === null ? "" : String(text).trim();
    }
  }
  return "";
}

function contextTokenKey(accountId: string, chatId: string): string {
  return `${accountId}:${chatId}`;
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

function normalizeAccountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "default";
  }
  const lowered = trimmed.toLowerCase();
  const normalized = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)
    ? lowered
    : lowered
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .slice(0, 64);
  return normalized && !isBlockedObjectKey(normalized) ? normalized : "default";
}

function isBlockedObjectKey(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(value: string): string {
  return value ? value.slice(0, 8) : "";
}
