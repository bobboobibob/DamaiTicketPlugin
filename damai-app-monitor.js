// damai-app-monitor.js
const config = {
  sessionId: "YOUR_SESSION_ID",
  eventId: "YOUR_EVENT_ID",
  apiHost: "https://mtop.damai.cn",
  appVersion: "10.2.0",
};

function checkTicketStatus() {
  let url = `${config.apiHost}/mtop.damai.wireless.project.detail`;
  let body = { projectId: config.eventId };

  $httpClient.post(
    {
      url: url,
      headers: {
        "Cookie": `sessionId=${config.sessionId}`,
        "Content-Type": "application/json",
        "User-Agent": `DamaiApp/${config.appVersion} (iPhone; iOS 16.0; Scale/3.00)`,
        "x-app-ver": config.appVersion,
      },
      body: JSON.stringify({ data: body }),
    },
    (error, response, data) => {
      if (error) {
        $notification.post("监控失败", "网络错误", error);
        return;
      }
      try {
        let result = JSON.parse(data);
        let stock = result.data?.perform?.skuList?.[0]?.stock;
        if (stock && stock > 0) {
          $notification.post("票务提醒", `场次 ${config.eventId} 有票！`, "启动抢票...");
        } else {
          $notification.post("票务提醒", `场次 ${config.eventId} 无票`, "");
        }
      } catch (e) {
        $notification.post("监控错误", "解析失败", e.message);
      }
    }
  );
}

checkTicketStatus();
$done();