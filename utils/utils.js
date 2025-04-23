const fs = require("fs");
const colors = require("colors");
const path = require("path");
require("dotenv").config();
const { jwtDecode } = require("jwt-decode");
const fsPromises = require("fs").promises; // Sử dụng fs.promises
const AsyncLock = require("async-lock");
const lock = new AsyncLock();
const sharp = require("sharp");
const { Buffer } = require("buffer");

function _isArray(obj) {
  if (Array.isArray(obj) && obj.length > 0) {
    return true;
  }

  try {
    const parsedObj = JSON.parse(obj);
    return Array.isArray(parsedObj) && parsedObj.length > 0;
  } catch (e) {
    return false;
  }
}

function parseQueryString(query) {
  const params = new URLSearchParams(query);
  const parsedQuery = {};

  for (const [key, value] of params) {
    parsedQuery[key] = decodeURIComponent(value);
  }

  return parsedQuery;
}

function splitIdPet(num) {
  const numStr = num.toString();
  const firstPart = numStr.slice(0, 3); // Lấy 3 ký tự đầu tiên
  const secondPart = numStr.slice(3); // Lấy phần còn lại

  return [parseInt(firstPart), parseInt(secondPart)];
}

// Hàm để ghi đè biến môi trường
const envFilePath = path.join(__dirname, ".env");
function updateEnv(variable, value) {
  // Đọc file .env
  fs.readFile(envFilePath, "utf8", (err, data) => {
    if (err) {
      console.log("Không thể đọc file .env:", err);
      return;
    }

    // Tạo hoặc cập nhật biến trong file
    const regex = new RegExp(`^${variable}=.*`, "m");
    let newData = data.replace(regex, `${variable}=${value}`); // Sử dụng let thay vì const

    // Kiểm tra nếu biến không tồn tại trong file, thêm vào cuối
    if (!regex.test(data)) {
      newData += `\n${variable}=${value}`;
    }

    // Ghi lại file .env
    fs.writeFile(envFilePath, newData, "utf8", (err) => {
      if (err) {
        console.error("Không thể ghi file .env:", err);
      } else {
        // console.log(`Đã cập nhật ${variable} thành ${value}`);
      }
    });
  });
}

async function sleep(seconds = null) {
  if (seconds && typeof seconds === "number") return new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  let DELAY_BETWEEN_REQUESTS = [1, 5];
  if (seconds && Array.isArray(seconds)) {
    DELAY_BETWEEN_REQUESTS = seconds;
  }
  min = DELAY_BETWEEN_REQUESTS[0];
  max = DELAY_BETWEEN_REQUESTS[1];

  return await new Promise((resolve) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, delay * 1000);
  });
}

function randomDelay() {
  return new Promise((resolve) => {
    const minDelay = process.env.DELAY_REQUEST_API[0];
    const maxDelay = process.env.DELAY_REQUEST_API[1];
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    setTimeout(resolve, delay * 1000);
  });
}

function saveToken(id, token) {
  const tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
  tokens[id] = token;
  fs.writeFileSync("tokens.json", JSON.stringify(tokens, null, 4));
}

function getToken(id) {
  const tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
  return tokens[id] || null;
}
function isTokenExpired(token) {
  if (!token) return { isExpired: true, expirationDate: new Date().toLocaleString() };

  try {
    const payload = jwtDecode(token);
    if (!payload) return { isExpired: true, expirationDate: new Date().toLocaleString() };
    if (!payload.exp) return { isExpired: false, expirationDate: "Infinity" };

    const now = Math.floor(Date.now() / 1000);

    const expirationDate = new Date(payload.exp ? payload.exp * 1000 : "").toLocaleString();
    const isExpired = now > payload.exp;

    return { isExpired, expirationDate };
  } catch (error) {
    console.log(`Error checking token: ${error.message}`.red);
    return { isExpired: true, expirationDate: new Date().toLocaleString() };
  }
}

function generateRandomHash() {
  const characters = "0123456789abcdef";
  let hash = "0x"; // Bắt đầu bằng "0x"

  for (let i = 0; i < 64; i++) {
    // 64 ký tự cho hash
    const randomIndex = Math.floor(Math.random() * characters.length);
    hash += characters[randomIndex];
  }

  return hash;
}

function getRandomElement(arr) {
  const randomIndex = Math.floor(Math.random() * arr.length);
  return arr[randomIndex];
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function loadData(file) {
  try {
    const datas = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
    if (datas?.length <= 0) {
      console.log(colors.red(`Không tìm thấy dữ liệu ${file}`));
      return [];
    }
    return datas;
  } catch (error) {
    console.log(`Không tìm thấy file ${file}`.red);
    return [];
  }
}

async function saveData(data, filename) {
  fs.writeFileSync(filename, data.join("\n"));
}

function log(msg, type = "info") {
  switch (type) {
    case "success":
      console.log(`[*] ${msg}`.green);
      break;
    case "custom":
      console.log(`[*] ${msg}`.magenta);
      break;
    case "error":
      console.log(`[!] ${msg}`.red);
      break;
    case "warning":
      console.log(`[*] ${msg}`.yellow);
      break;
    default:
      console.log(`[*] ${msg}`.blue);
  }
}

async function saveJson(id, value, filename) {
  await lock.acquire("fileLock", async () => {
    try {
      const data = await fsPromises.readFile(filename, "utf8");
      const jsonData = JSON.parse(data);
      jsonData[id] = value;
      await fsPromises.writeFile(filename, JSON.stringify(jsonData, null, 4));
    } catch (error) {
      console.error("Error saving JSON:", error);
    }
  });
}

function getItem(id, filename) {
  const data = JSON.parse(fs.readFileSync(filename, "utf8"));
  return data[id] || null;
}

function getOrCreateJSON(id, value, filename) {
  let item = getItem(id, filename);
  if (item) {
    return item;
  }
  item = saveJson(id, value, filename);
  return item;
}

function generateComplexId(length = 9) {
  const chars = "0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomNumber(length) {
  if (length < 1) return null;

  // Chọn chữ số đầu tiên từ 1 đến 4
  const firstDigit = Math.floor(Math.random() * 4) + 1; // 1 đến 4
  let number = firstDigit.toString(); // Bắt đầu với chữ số đầu tiên

  // Tạo các chữ số còn lại
  for (let i = 1; i < length; i++) {
    number += Math.floor(Math.random() * 10); // 0 đến 9
  }

  return number;
}

function getRandomNineDigitNumber() {
  const min = 100000000; // Số 9 chữ số nhỏ nhất
  const max = 999999999; // Số 9 chữ số lớn nhất
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function decodeJWT(token) {
  const [header, payload, signature] = token.split(".");

  // Decode Base64 URL
  const decodeBase64Url = (str) => {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(str));
  };

  const decodedHeader = decodeBase64Url(header);
  const decodedPayload = decodeBase64Url(payload);

  return {
    header: decodedHeader,
    payload: decodedPayload,
    signature: signature, // You might not need to decode the signature
  };
}

const getRandomDate = () => {
  const now = new Date();
  const daysAgo = Math.floor(getRandomNumber(0, 30));
  const randomDate = new Date(now);
  randomDate.setDate(now.getDate() - daysAgo);
  return randomDate.toLocaleDateString();
};

const getRandomName = () => {
  const firstNames = [
    "John",
    "Jane",
    "Mike",
    "Emma",
    "David",
    "Sarah",
    "Robert",
    "Linda",
    "William",
    "Emily",
    "James",
    "Olivia",
    "Alex",
    "Sophia",
    "Daniel",
    "Mia",
    "Thomas",
    "Ava",
    "Joseph",
    "Isabella",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Brown",
    "Taylor",
    "Miller",
    "Wilson",
    "Moore",
    "Jackson",
    "Martin",
    "Lee",
    "Davis",
    "White",
    "Harris",
    "Clark",
    "Lewis",
    "Young",
    "Walker",
    "Hall",
    "Allen",
    "Wright",
  ];

  return `${getRandomElement(firstNames)} ${getRandomElement(lastNames)}`;
};

function generateInvoiceNumber() {
  const prefix = getRandomElement(["TRD", "INV", "PAY", "BLN"]);
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${letters}-${digits}`;
}

function generateRandomInvoice() {
  const payers = getRandomName();
  const payees = ["TradeRiser Inc.", "StockPro Ltd.", "InvestEasy Co.", "CryptoPay LLC"];
  const paymentMethods = [
    "Bank: IBAN GB29NWBK60161331926819",
    "PayPal: payments@traderiser.com",
    "Bank Transfer: HSBC UK 12345678",
    "Credit Card: Visa ending 1234",
    "Wire Transfer: Chase Bank 87654321",
    "Check Payment: Ref# 456789",
    "Cash Payment: Office Drop-off",
  ];
  const statuses = ["Pending", "Paid", "Overdue", "Cancelled"];
  const descriptions = ["Payment for stock trading services", "Subscription fee", "Investment consultation", "Crypto transaction fee"];

  const date = getRandomDate();

  return {
    invoiceNumber: generateInvoiceNumber(),
    date,
    payer: payers,
    payee: getRandomElement(payees),
    paymentAddress: getRandomElement(paymentMethods),
    amount: (Math.random() * 100 + 100).toFixed(2),
    currency: getRandomElement(["USD", "BTC", "ETH", "INR"]),
    description: getRandomElement(descriptions),
    status: getRandomElement(statuses),
    discount: getRandomFloat(0, 15), // discount từ 0% - 15%
  };
}

const getRandomFloat = (min, max, decimals = 2) => {
  const num = Math.random() * (max - min) + min;
  return parseFloat(num.toFixed(decimals));
};

function generateFakeMetadata() {
  const authors = ["John Doe", "Jane Smith", "Alex Johnson", "Emily Brown"];
  const startDate = new Date("2015-01-01");
  const endDate = new Date("2025-04-12");
  const randomDate = new Date(startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime()));

  return {
    Title: `Invoice-${Math.floor(Math.random() * 10000)}`,
    Author: authors[Math.floor(Math.random() * authors.length)],
    Description: `Generated invoice for payment on ${randomDate.toLocaleDateString("en-US")}`,
    Software: `InvoiceGen v${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 10)}`,
    "Creation Time": randomDate.toISOString(),
    Company: ["TradeRiser", "StockPro", "InvestEasy"][Math.floor(Math.random() * 3)],
  };
}

async function generateInvoice(invoice) {
  const estimateTextWidth = (text, fontSize = 12) => text.length * (fontSize * 0.75);
  const maxTextWidth = Math.max(
    estimateTextWidth(invoice.invoiceNumber, 14),
    estimateTextWidth(invoice.date, 14),
    estimateTextWidth(invoice.payer, 14),
    estimateTextWidth(invoice.payee, 14),
    estimateTextWidth(invoice.description, 14),
    estimateTextWidth(`${invoice.currency} ${invoice.amount}`, 14),
    estimateTextWidth(invoice.paymentAddress, 14)
  );
  const width = maxTextWidth + 100;
  const height = 60 + 220;

  const templates = [
    (invoice) => `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
                <rect width="100%" height="100%" fill="#FFFFFF"/>
                <text x="20" y="40" font-family="Arial" font-size="20" font-weight="bold" fill="#000000">Billing</text>
                <line x1="0" y1="60" x2="${width}" y2="60" stroke="#007BFF" stroke-width="2"/>
                <text x="20" y="80" font-family="Arial" font-size="14" font-weight="bold" fill="#000000">Invoice #: ${invoice.invoiceNumber}</text>
                <text x="20" y="100" font-family="Arial" font-size="12" fill="#000000">Date: ${invoice.date}</text>
                <text x="20" y="120" font-family="Arial" font-size="12" fill="#000000">From: ${invoice.payer}</text>
                <text x="20" y="140" font-family="Arial" font-size="12" fill="#000000">To: ${invoice.payee}</text>
                <text x="20" y="160" font-family="Arial" font-size="12" fill="#000000">Description: ${invoice.description}</text>
                <text x="20" y="180" font-family="Arial" font-size="12" fill="#000000">Amount: ${invoice.currency} ${invoice.amount}</text>
                <text x="20" y="200" font-family="Arial" font-size="12" fill="#000000">Payment Address:</text>
                <text x="20" y="220" font-family="Arial" font-size="12" fill="#000000">${invoice.paymentAddress}</text>
                <line x1="20" y1="240" x2="${width - 20}" y2="240" stroke="#D3D3D3" stroke-width="1"/>
                <text x="20" y="260" font-family="Arial" font-size="12" fill="#000000">Thank you for your payment!</text>
            </svg>`,
    (invoice) => `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <text x="20" y="30" font-family="Arial" font-size="18" font-weight="bold" fill="#000000">INVOICE</text>
        <text x="${width * 0.6}" y="30" font-family="Arial" font-size="12" fill="#555555">Date: ${invoice.date}</text>

        <text x="20" y="60" font-family="Arial" font-size="12" fill="#000000">Invoice #: ${invoice.invoiceNumber}</text>
        <text x="20" y="75" font-family="Arial" font-size="12" fill="#000000">From: ${invoice.payer}</text>
        <text x="20" y="90" font-family="Arial" font-size="12" fill="#000000">To: ${invoice.payee}</text>

        <rect x="20" y="110" width="${width - 40}" height="20" fill="#007BFF"/>
        <text x="25" y="125" font-family="Arial" font-size="12" font-weight="bold" fill="#ffffff">Description</text>
        <text x="${width * 0.4}" y="125" font-family="Arial" font-size="12" font-weight="bold" fill="#ffffff">Amount</text>
        <text x="${width * 0.6}" y="125" font-family="Arial" font-size="12" font-weight="bold" fill="#ffffff">Status</text>
        <text x="${width * 0.76}" y="125" font-family="Arial" font-size="12" font-weight="bold" fill="#ffffff">Discount</text>

        <rect x="20" y="130" width="${width - 40}" height="20" fill="#f8f8f8"/>
        <text x="25" y="145" font-family="Arial" font-size="12" fill="#000000">${invoice.description}</text>
        <text x="${width * 0.4}" y="145" font-family="Arial" font-size="12" fill="#000000">${invoice.currency} ${invoice.amount}</text>
        <text x="${width * 0.6}" y="145" font-family="Arial" font-size="12" fill="#000000">${invoice.status}</text>
        <text x="${width * 0.76}" y="145" font-family="Arial" font-size="12" fill="#000000">${invoice.discount}%</text>

        <text x="20" y="180" font-family="Arial" font-size="12" fill="#000000">Payment Method:</text>
        <text x="20" y="195" font-family="Arial" font-size="12" fill="#000000">${invoice.paymentAddress}</text>

        <line x1="20" y1="210" x2="${width - 20}" y2="210" stroke="#ccc" stroke-width="1"/>
        <text x="20" y="230" font-family="Arial" font-size="12" fill="#888888">Thank you for your business.</text>
    </svg>`,
    (invoice) => `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
                <rect width="100%" height="100%" fill="#F8F8F8"/>
                <text x="20" y="30" font-family="Verdana" font-size="18" fill="#333333">Billing Statement</text>
                <text x="300" y="30" font-family="Verdana" font-size="12" fill="#666666">${invoice.date}</text>
                <text x="20" y="60" font-family="Verdana" font-size="12" fill="#000000">Invoice #: ${invoice.invoiceNumber}</text>
                <text x="20" y="80" font-family="Verdana" font-size="12" fill="#000000">Payer: ${invoice.payer}</text>
                <text x="20" y="100" font-family="Verdana" font-size="12" fill="#000000">Payee: ${invoice.payee}</text>
                <text x="20" y="120" font-family="Verdana" font-size="12" fill="#000000">${invoice.description}</text>
                <text x="20" y="140" font-family="Verdana" font-size="12" fill="#000000">Amount: ${invoice.currency} ${invoice.amount}</text>
                <text x="20" y="160" font-family="Verdana" font-size="12" fill="#000000">Pay at: ${invoice.paymentAddress}</text>
                <line x1="20" y1="180" x2="${width - 20}" y2="180" stroke="#CCCCCC" stroke-width="1"/>
                <text x="20" y="200" font-family="Verdana" font-size="12" fill="#888888">Thank you for doing business with us!</text>
            </svg>`,
  ];

  const svgContent = getRandomElement(templates)(invoice);
  const metadata = generateFakeMetadata();

  return await sharp(Buffer.from(svgContent)).png({ text: metadata }).toBuffer();
}

const generateFileName = () => {
  const randomString = Math.random().toString(36).substring(2, 12);
  const timestamp = Date.now();
  return `invoice-${timestamp}-${randomString}.png`;
};

module.exports = {
  generateRandomInvoice,
  getRandomDate,
  getRandomName,
  generateFileName,
  _isArray,
  saveJson,
  decodeJWT,
  generateComplexId,
  getRandomNumber,
  updateEnv,
  saveToken,
  splitIdPet,
  getToken,
  isTokenExpired,
  generateRandomHash,
  getRandomElement,
  loadData,
  saveData,
  log,
  getOrCreateJSON,
  sleep,
  randomDelay,
  parseQueryString,
  getRandomNineDigitNumber,
  generateRandomNumber,
  generateInvoice,
};
