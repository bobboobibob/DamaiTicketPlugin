// damai-app-ticket.js
let request = $request;
let response = $response;
let body = response ? response.body : null;

// 配置参数（需用户自行抓包获取）
const config = {
  sessionId: "YOUR_SESSION_ID", // 大麦 App 的 sessionId，抓包获取
  eventId: "YOUR_EVENT_ID", // 场次 ID，如 "123456"
  ticketPriceId: "YOUR_PRICE_ID", // 票档 ID，如 "789012"
  viewerId: "YOUR_VIEWER_ID", // 观演人 ID，需在 App 中设置
  quantity: 1, // 购票数量
  apiHost: "https://mtop.damai.cn", // 默认 API 主机
  appVersion: "10.2.0", // 大麦 App 版本号，需匹配实际版本
};

// 处理请求
if (request) {
  if (request.url.match(/mtop\.damai\.cn|h5api\.m\.damai\.cn/)) {
    // 添加 App 专属头
    request.headers["Cookie"] = `sessionId=${config.sessionId}`;
    request.headers["User-Agent"] = `DamaiApp/${config.appVersion} (iPhone; iOS 16.0; Scale/3.00)`;
    request.headers["x-app-ver"] = config.appVersion;
    request.headers["x-device-id"] = "YOUR_DEVICE_ID"; // 可选，抓包获取
    $done({ request });
  }
}

// 处理响应
if (body) {
  try {
    let data = JSON.parse(body);

    // 检查库存状态（基于 mtop API）
    if (request.url.includes("mtop.damai.wireless.project.detail")) {
      let stock = data.data?.perform?.skuList?.[0]?.stock;
      if (stock && stock > 0) {
        $notification.post("票务提醒", `场次 ${config.eventId} 有票！`, "准备抢票...");
        submitOrder();
      } else {
        $notification.post("票务提醒", `场次 ${config.eventId} 无票`, "");
      }
    }

    // 处理订单提交结果
    if (request.url.includes("mtop.trade.order.create")) {
      if (data.ret?.[0]?.includes("SUCCESS")) {
        $notification.post("抢票成功", "订单已提交！", JSON.stringify(data));
      } else {
        $notification.post("抢票失败", "重试中...", data.ret?.[0] || "未知错误");
        setTimeout(submitOrder, 500); // 0.5秒后重试
      }
    }

    $done({ body });
  } catch (e) {
    $notification.post("脚本错误", "解析响应失败", e.message);
    $done({ body });
  }
}

// 提交订单函数
function submitOrder() {
  let orderUrl = `${config.apiHost}/mtop.trade.order.create`;
  let orderData = {
    projectId: config.eventId,
    skuId: config.ticketPriceId,
    buyerId: config.viewerId,
    buyNum: config.quantity,
    timestamp: Date.now(),
  };

  $httpClient.post(
    {
      url: orderUrl,
      headers: {
        "Cookie": `sessionId=${config.sessionId}`,
        "Content-Type": "application/json",
        "User-Agent": `DamaiApp/${config.appVersion} (iPhone; iOS 16.0; Scale/3.00)`,
        "x-app-ver": config.appVersion,
      },
      body: JSON.stringify({ data: orderData }),
    },
    (error, response, data) => {
      if (error) {
        $notification.post("订单提交失败", "网络错误", error);
        setTimeout(submitOrder, 500); // 重试
      } else {
        $notification.post("订单提交", "响应已接收", data);
      }
    }
  );
}

$done();