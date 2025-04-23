const fs = require("fs");
const fsPromises = require("fs").promises;

const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents.js");
const settings = require("./config/config.js");
const {
  sleep,
  loadData,
  getRandomNumber,
  saveToken,
  isTokenExpired,
  saveJson,
  updateEnv,
  decodeJWT,
  getRandomElement,
  generateFileName,
  generateRandomInvoice,
  generateInvoice,
} = require("./utils/utils.js");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./utils/checkAPI.js");
const { headers, headersSowing } = require("./core/header.js");
const { showBanner } = require("./core/banner.js");
const localStorage = require("./localStorage.json");
const { v4: uuidv4 } = require("uuid");
const { Wallet, ethers } = require("ethers");

class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL) {
    this.headers = headers;
    this.baseURL = baseURL;
    this.baseURL_v2 = settings.BASE_URL_V2;

    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyPrams = null;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.localStorage = localStorage;
    // this.provider = new ethers.JsonRpcProvider({
    //   url: "https://rpc-mainnet.taker.xyz/",

    // });
    this.wallet = new ethers.Wallet(this.itemData.privateKey);
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.wallet.address;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Account ${this.accountIndex + 1}][${this.wallet.address}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);

      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        const prs = this.proxy.replace("http://", "").replace("@", ":").split(":");
        this.proxyPrams = {
          username: prs[0],
          password: prs[1],
          host: prs[2],
          port: prs[3],
        };
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 2,
      isAuth: false,
      extraHeaders: {},
      refreshToken: null,
    }
  ) {
    const { retries, isAuth, extraHeaders, refreshToken } = options;

    const headers = {
      ...this.headers,
      ...extraHeaders,
    };

    if (!isAuth && this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0,
      errorMessage = null,
      errorStatus = 0;

    do {
      try {
        const response = await axios({
          method,
          url,
          headers,
          timeout: 120000,
          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
          ...(method.toLowerCase() != "get" ? { data } : {}),
        });
        if ((response?.data?.msg?.code && response?.data?.msg?.code == 401) || (response?.data?.code && response?.data?.code == 401)) {
          this.token = await this.getValidToken(true);
          return await this.makeRequest(url, method, data, options);
        }
        if (response?.data?.msg?.code >= 400 || response?.data?.code >= 400) {
          return { success: false, data: response.data, status: response?.data?.data?.code >= 400 || response?.data?.code >= 400, error: response.data?.msg || "unknow" };
        }
        if (response?.data?.msg) return { status: response.status, success: true, data: response.data.msg, error: null };
        return { success: true, data: response.data, status: response.status, error: null };
      } catch (error) {
        errorStatus = error.status;
        errorMessage = error?.response?.data?.message ? error?.response?.data : error.message;
        this.log(`Request failed: ${url} | Status: ${error.status} | ${JSON.stringify(errorMessage || {})}...`, "warning");

        if (error.status == 401) {
          this.log(`Unauthorized: ${url} | trying get new token...`);
          this.token = await this.getValidToken(true);
          return await this.makeRequest(url, method, data, options);
        }
        if (error.status == 400) {
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/airdrophuntersieutoc to get new update!`, "error");
          return { success: false, status: error.status, error: errorMessage, data: null };
        }
        if (error.status == 429) {
          this.log(`Rate limit ${JSON.stringify(errorMessage)}, waiting 60s to retries`, "warning");
          await sleep(60);
        }
        if (currRetries > retries) {
          return { status: error.status, success: false, error: errorMessage, data: null };
        }
        currRetries++;
        await sleep(5);
      }
    } while (currRetries <= retries);
    return { status: errorStatus, success: false, error: errorMessage, data: null };
  }

  async auth() {
    const url = `${this.baseURL}/account/login`;
    const result = await this.getNonce();
    if (!result.success) {
      this.log("Can't get nonce", "error");
      return { success: false };
    }
    const message = result.data.content;
    const signedMessage = await this.wallet.signMessage(message);
    const payload = {
      address: this.itemData.address,
      signature: signedMessage,
      chain_id: 1,
      referral_code: settings.REF_CODE,
    };
    return this.makeRequest(url, "post", payload);
  }

  async getNonce() {
    return this.makeRequest(`${this.baseURL}/account/sign_content?address=${this.itemData.address}`, "get", null, { isAuth: true });
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL}/user`, "get");
  }

  async getPresignedUrl(fileName) {
    return this.makeRequest(`${this.baseURL}/scan2earn/get_presigned_url?file_name=${fileName}`, "get");
  }

  async updatePresignedUrl(url, fileName) {
    url = new URL(url);
    return this.makeRequest(`${url}`, "put", fileName, {
      extraHeaders: {
        "Content-Type": "application/octet-stream",
      },
      isAuth: true,
    });
  }

  async saveInvoice(key) {
    return this.makeRequest(`${this.baseURL}/scan2earn/save_invoice`, "post", { invoice_path: key });
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/users/exp`, "get");
  }

  async getCheckin() {
    return this.makeRequest(`${this.baseURL}/account/personalcenter/quests/daily`, "get");
  }
  async getTasks() {
    return this.makeRequest(`${this.baseURL}/account/personalcenter/quests/daily`, "get");
  }

  async completeTask(quest_id) {
    return this.makeRequest(`${this.baseURL}/account/personalcenter/quests/complete`, "post", { quest_id });
  }

  async handleUploadAndSaveOnce() {
    const filename = generateFileName();
    this.log(`Generating unique invoice: ${filename}`);
    const invoiceData = generateRandomInvoice();

    const invoiceBuffer = await generateInvoice(invoiceData);

    this.log("Fetching presigned URL...");
    const res = await this.getPresignedUrl(filename);
    if (!res.success) return this.log(`Can't get url | ${JSON.stringify(res)}`, "warning");
    const presignedUrl = res.data.presigned_url;
    const key = res.data.key;

    this.log(`Uploading invoice to S3...`);
    const resUpdate = await this.updatePresignedUrl(presignedUrl, invoiceBuffer);
    if (!resUpdate.success) return this.log(`Can't upload invoice | ${JSON.stringify(resUpdate)}`, "warning");
    this.log("Image uploaded successfully", "success");

    this.log("Saving invoice metadata...");
    const result = await this.saveInvoice(key);
    if (result.success && result?.data) {
      if (settings.AUTO_SAVE_IMAGE_BILLS) {
        const accountDir = path.join(__dirname, "invoices", `WL_${this.itemData.address}`);
        await fsPromises.mkdir(accountDir, { recursive: true });
        const outputPath = path.join(accountDir, filename);
        await fsPromises.writeFile(outputPath, invoiceBuffer);
        this.log(colors.green(` 💾 Invoice image saved to: ${outputPath}`));
      } else {
        this.log(`Scan bill success | ${JSON.stringify(result.data)}`, "success");
      }
    }
    if (!result.success) return this.log(`Can't save invoice | ${JSON.stringify(result)}`, "warning");
  }

  async handleTasks() {
    const tasks = await this.getTasks();
    if (!tasks.success) {
      this.log("Can't get tasks", "error");
      return;
    }
    if (tasks.data?.length == 0) {
      this.log("No tasks available", "warning");
      return;
    }
    const taskAvaliable = tasks.data.quests.filter((item) => !item.completed_today && !settings.SKIP_TASKS.includes(item.id));

    for (const task of taskAvaliable) {
      const { id, title, points } = task;
      const timeSleep = getRandomNumber(settings.DELAY_TASK[0], settings.DELAY_TASK[1]);
      this.log(`Starting task ${id} | ${title} | Delay ${timeSleep}s...`, "info");
      await sleep(timeSleep);
      const result = await this.completeTask(id);
      if (result.success && result?.data?.message === "Quest completed successfully") {
        this.log(`Task ${id} | ${title} completed successfully | Reward: ${points} | ${JSON.stringify(result.data)}`, "success");
      } else {
        this.log(`Task ${id} | ${title} failed: ${JSON.stringify(result || {})}`, "warning");
      }
    }
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const { isExpired: isExp, expirationDate } = isTokenExpired(existingToken);

    this.log(`Access token status: ${isExp ? "Expired".yellow : "Valid".green} | Acess token exp: ${expirationDate}`);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("No found token or experied, logining......", "warning");
    const loginRes = await this.auth();
    if (loginRes.success) {
      console.log(loginRes);
      await saveJson(this.session_name, JSON.stringify(loginRes.data || {}), "localStorage.json");
      return loginRes;
    }
    this.log("Can't get new token...", "warning");
    return null;
  }

  async handleSyncData() {
    let userData = { success: false, data: null },
      retries = 0;
    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 2);
    if (userData.success) {
      const { referral_code, points, email } = userData.data;
      this.log(`[${referral_code}] Email: ${email ? "Connected" : "Not set"} | Points: ${points || 0}`, "custom");
    } else {
      return this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  async runAccount() {
    const accountIndex = this.accountIndex;
    this.session_name = this.wallet.address;
    this.token = JSON.parse(this.localStorage[this.session_name] || "{}")?.token || null;
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${accountIndex + 1} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    const userData = await this.handleSyncData();
    if (userData.success) {
      if (settings.AUTO_TASK) {
        await this.handleTasks();
        await sleep(1);
      }

      let amount = getRandomNumber(settings.AMOUNT_SCAN[0], settings.AMOUNT_SCAN[1]);
      let scanIndex = 1;
      while (scanIndex <= amount) {
        const timeSleep = getRandomNumber(settings.DELAY_BETWEEN_REQUESTS[0], settings.DELAY_BETWEEN_REQUESTS[1]);
        this.log(colors.cyan(`🔄 [${scanIndex}/${amount}] Starting scan | Delay ${timeSleep}s...`));
        await sleep(timeSleep);
        scanIndex++;
        try {
          await this.handleUploadAndSaveOnce();
        } catch (error) {
          this.log(`Scan err: ${error.message}`, "error");
          continue;
        }
      }
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { itemData, accountIndex, proxy, hasIDAPI } = workerData;
  const to = new ClientAPI(itemData, accountIndex, proxy, hasIDAPI);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  console.clear();
  showBanner();
  const privateKeys = loadData("privateKeys.txt");
  const proxies = loadData("proxy.txt");
  const data = privateKeys.map((item) => (item.startsWith("0x") ? item : `0x${item}`));
  if (data.length == 0 || (data.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${data.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }
  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint, message } = await checkBaseUrl();
  if (!endpoint) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);

  const itemDatas = data
    .map((val, index) => {
      const prvk = val.startsWith("0x") ? val : `0x${val}`;
      let wallet = new ethers.Wallet(prvk);
      const item = {
        index,
        privateKey: prvk,
        address: wallet.address,
      };
      new ClientAPI(item, index, proxies[index], endpoint).createUserAgent();
      return item;
    })
    .filter((i) => i !== null);

  process.on("SIGINT", async () => {
    console.log("Stopping...".yellow);
    // stopInterVal();
    await sleep(1);
    process.exit();
  });

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];
    while (currentIndex < data.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, data.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI: endpoint,
            itemData: itemDatas[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    await sleep(3);
    console.log(`=============${new Date().toLocaleString()} | Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    showBanner();
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
