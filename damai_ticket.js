// Loon 插件：大麦余票监控与自动提交订单
// 适用于大麦 iOS 客户端
// 作者：Grok

(function() {
    'use strict';

    // 配置项（用户需修改）
    const CONFIG = {
        TICKET_URL: 'https://m.damai.cn/shows/item.html?itemId=902193434418', // 抢票链接
        TARGET_DATE: '2025-05-03', // 目标场次日期，例如：2025-05-03
        TARGET_PRICE: '1280', // 目标票价，例如：1280
        MAX_RETRIES: 3, // 最大重试次数
        CHECK_INTERVAL: 1000, // 监控间隔（毫秒，建议 1-2 秒）
        NOTIFY_URL: '' // 可选：Bark 通知 URL
    };

    // 全局变量
    let retryCount = 0;
    let isRunning = false;
    let sessionId = '';
    let priceId = '';

    // 提取 itemId
    function getItemId(url) {
        const match = url.match(/itemId=(\d+)/);
        return match ? match[1] : null;
    }

    // 获取演出信息
    function fetchEventInfo(itemId) {
        const apiUrl = `https://mtop.damai.cn/h5/mtop.damai.item.detail/1.0/?itemId=${itemId}`;
        return new Promise((resolve, reject) => {
            $httpClient.get({
                url: apiUrl,
                headers: {
                    'User-Agent': 'Damai/10.2.0 (iPhone; iOS 16.0)',
                    'Content-Type': 'application/json',
                    'Cookie': $request.headers.Cookie || ''
                }
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    if (response && (response.status === 401 || response.status === 403)) {
                        reject('登录失效，请在 大麦 App 中重新登录');
                    } else {
                        reject('获取演出信息失败');
                    }
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (!json.data) {
                        reject('演出信息为空');
                        return;
                    }
                    const sessions = json.data.performList || [];
                    const prices = json.data.priceList || [];
                    let info = `演出名称: ${json.data.itemName || '未知'}\n场次:\n`;
                    sessions.forEach(s => {
                        info += `- ${s.performTime} (ID: ${s.performId})\n`;
                    });
                    info += '票价:\n';
                    prices.forEach(p => {
                        info += `- ${p.price}元 (ID: ${p.priceId})\n`;
                    });

                    // 匹配用户输入的 TARGET_DATE 和 TARGET_PRICE
                    let matchedSession = sessions.find(s => s.performTime.includes(CONFIG.TARGET_DATE));
                    let matchedPrice = prices.find(p => p.price == CONFIG.TARGET_PRICE);

                    if (!matchedSession || !matchedPrice) {
                        reject(`未找到匹配的场次或票价：${CONFIG.TARGET_DATE}, ${CONFIG.TARGET_PRICE}元`);
                        return;
                    }

                    sessionId = matchedSession.performId;
                    priceId = matchedPrice.priceId;
                    resolve(info);
                } catch (e) {
                    reject('解析演出信息失败：' + e.message);
                }
            });
        });
    }

    // 监测余票
    function checkStock(sessionId, priceId) {
        const stockUrl = `https://mtop.damai.cn/h5/mtop.damai.item.tickets/1.0/?itemId=${sessionId}&priceId=${priceId}`;
        return new Promise((resolve, reject) => {
            $httpClient.get({
                url: stockUrl,
                headers: {
                    'User-Agent': 'Damai/10.2.0 (iPhone; iOS 16.0)',
                    'Content-Type': 'application/json',
                    'Cookie': $request.headers.Cookie || ''
                }
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    retryCount++;
                    if (retryCount < CONFIG.MAX_RETRIES) {
                        setTimeout(() => checkStock(sessionId, priceId), CONFIG.CHECK_INTERVAL);
                        return;
                    }
                    if (response && (response.status === 401 || response.status === 403)) {
                        reject('登录失效，请在 大麦 App 中重新登录');
                    } else {
                        reject('网络错误，重试失败');
                    }
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (json.result && json.result.stock > 0) {
                        resolve(json.result.stock);
                    } else {
                        resolve(0);
                    }
                } catch (e) {
                    reject('解析库存失败：' + e.message);
                }
            });
        });
    }

    // 提交订单
    function submitOrder(sessionId, priceId, quantity = 1) {
        const orderUrl = 'https://mtop.damai.cn/h5/mtop.trade.order.create/1.0/';
        const orderData = {
            itemId: sessionId,
            priceId: priceId,
            quantity: quantity,
            buyerInfo: {}, // 假设已填写购票人信息
            source: 'app'
        };
        return new Promise((resolve, reject) => {
            $httpClient.post({
                url: orderUrl,
                headers: {
                    'User-Agent': 'Damai/10.2.0 (iPhone; iOS 16.0)',
                    'Content-Type': 'application/json',
                    'Cookie': $request.headers.Cookie || ''
                },
                body: JSON.stringify(orderData)
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    if (response && (response.status === 401 || response.status === 403)) {
                        reject('登录失效，请在 大麦 App 中重新登录');
                    } else {
                        reject('提交订单失败');
                    }
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (json.result && json.result.orderId) {
                        resolve(json.result.orderId);
                    } else {
                        reject('订单创建失败：' + (json.msg || '未知错误'));
                    }
                } catch (e) {
                    reject('解析订单响应失败：' + e.message);
                }
            });
        });
    }

    // 发送通知
    function sendNotification(title, message) {
        if (CONFIG.NOTIFY_URL) {
            $httpClient.post({
                url: CONFIG.NOTIFY_URL,
                body: JSON.stringify({ title, body: message })
            });
        }
        $notification.post(title, message, '');
    }

    // 主逻辑
    async function main() {
        if (!CONFIG.TICKET_URL) {
            sendNotification('错误', '请配置抢票链接');
            return;
        }

        const itemId = getItemId(CONFIG.TICKET_URL);
        if (!itemId) {
            sendNotification('错误', '无法从抢票链接中提取 itemId');
            return;
        }

        if (!CONFIG.TARGET_DATE || !CONFIG.TARGET_PRICE) {
            try {
                const eventInfo = await fetchEventInfo(itemId);
                sendNotification('演出信息', `请根据以下信息设置 TARGET_DATE 和 TARGET_PRICE:\n${eventInfo}\n注意：TARGET_DATE 应为完整日期（如 2025-05-03），TARGET_PRICE 应为票面价格（如 1280）`);
            } catch (e) {
                sendNotification('错误', e);
            }
            return;
        }

        if (isRunning) return;
        isRunning = true;

        try {
            // 获取演出信息并匹配 sessionId 和 priceId
            const eventInfo = await fetchEventInfo(itemId);
            sendNotification('演出信息', eventInfo);

            if (!sessionId || !priceId) {
                sendNotification('错误', '未找到匹配的 sessionId 或 priceId');
                return;
            }

            while (isRunning) {
                try {
                    const stock = await checkStock(sessionId, priceId);
                    if (stock > 0) {
                        sendNotification('有票！', `检测到${stock}张票，正在提交订单...`);
                        const orderId = await submitOrder(sessionId, priceId);
                        sendNotification('成功', `订单已提交！订单号: ${orderId}\n请打开大麦 App 手动支付`);
                        isRunning = false;
                        break;
                    } else {
                        sendNotification('无票', '继续监控中...');
                    }
                } catch (e) {
                    sendNotification('错误', e);
                }
                await new Promise(resolve => setTimeout(resolve, CONFIG.CHECK_INTERVAL + Math.random() * 500));
            }
        } catch (e) {
            sendNotification('错误', e);
        } finally {
            isRunning = false;
        }
    }

    // 启动脚本
    main();
})();
