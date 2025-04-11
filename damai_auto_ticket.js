// ==UserScript==
// @name         大麦iOS客户端自动抢票插件
// @version      1.0
// @description  自动检测大麦iOS客户端购票信息并提交订单
// @match        https://m.damai.cn/api/ticket/*
// @author       Grok
// ==/UserScript==

(function () {
    // 配置项
    const CONFIG = {
        pollingInterval: 1000, // 轮询间隔（毫秒）
        maxRetries: 50, // 最大重试次数
        apiEndpoints: {
            detail: "https://m.damai.cn/api/ticket/item/detail",
            sku: "https://m.damai.cn/api/ticket/item/sku",
            submit: "https://m.damai.cn/api/ticket/order/submit"
        }
    };

    // 存储用户输入
    let userConfig = {
        itemId: null,
        sessionId: null,
        ticketPrice: null,
        quantity: 1, // 默认买1张
        viewer: null // 观演人信息
    };

    // 日志输出
    function log(message) {
        $notification.post("大麦抢票", "", message);
        console.log(`[大麦抢票] ${message}`);
    }

    // 获取演出信息
    function fetchEventInfo(link) {
        const itemId = link.match(/item\.htm\?id=(\d+)/)?.[1];
        if (!itemId) {
            log("无效的抢票链接，请确保链接包含item id");
            return null;
        }

        return new Promise((resolve) => {
            $httpClient.get({
                url: `${CONFIG.apiEndpoints.detail}?itemId=${itemId}`,
                headers: $request.headers
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    log("获取演出信息失败");
                    resolve(null);
                    return;
                }

                try {
                    const json = JSON.parse(data);
                    if (json.success && json.data) {
                        resolve({
                            itemId: itemId,
                            name: json.data.itemName,
                            sessions: json.data.sessions.map(s => ({
                                sessionId: s.sessionId,
                                sessionName: s.sessionName,
                                ticketPrices: s.ticketPrices.map(t => ({
                                    priceId: t.priceId,
                                    price: t.price
                                }))
                            }))
                        });
                    } else {
                        log("演出信息解析失败");
                        resolve(null);
                    }
                } catch (e) {
                    log("解析演出信息出错: " + e.message);
                    resolve(null);
                }
            });
        });
    }

    // 显示演出信息并让用户选择
    async function promptUserSelection(link) {
        const eventInfo = await fetchEventInfo(link);
        if (!eventInfo) return false;

        log(`演出名称: ${eventInfo.name}`);

        // 构造场次选择提示
        const sessionOptions = eventInfo.sessions.map((s, i) => `${i + 1}. ${s.sessionName}`).join("\n");
        const sessionChoice = $input.prompt({
            title: "选择场次",
            message: `可用场次:\n${sessionOptions}`,
            placeholder: "输入场次编号（1, 2...）"
        });

        if (!sessionChoice) {
            log("未选择场次，脚本退出");
            return false;
        }

        const sessionIndex = parseInt(sessionChoice) - 1;
        if (sessionIndex < 0 || sessionIndex >= eventInfo.sessions.length) {
            log("场次编号无效");
            return false;
        }

        const selectedSession = eventInfo.sessions[sessionIndex];
        userConfig.sessionId = selectedSession.sessionId;

        // 构造票价选择提示
        const priceOptions = selectedSession.ticketPrices.map((t, i) => `${i + 1}. ${t.price}元`).join("\n");
        const priceChoice = $input.prompt({
            title: "选择票价",
            message: `可用票价:\n${priceOptions}`,
            placeholder: "输入票价编号（1, 2...）"
        });

        if (!priceChoice) {
            log("未选择票价，脚本退出");
            return false;
        }

        const priceIndex = parseInt(priceChoice) - 1;
        if (priceIndex < 0 || priceIndex >= selectedSession.ticketPrices.length) {
            log("票价编号无效");
            return false;
        }

        userConfig.itemId = eventInfo.itemId;
        userConfig.ticketPrice = selectedSession.ticketPrices[priceIndex].priceId;

        // 获取观演人信息（假设已在APP设置）
        const viewerInput = $input.prompt({
            title: "输入观演人",
            message: "请输入观演人姓名（需与大麦APP设置一致）",
            placeholder: "姓名"
        });

        if (!viewerInput) {
            log("未输入观演人，脚本退出");
            return false;
        }

        userConfig.viewer = viewerInput;
        log("配置完成，开始监控票务状态");
        return true;
    }

    // 检查票务状态
    function checkTicketStatus() {
        return new Promise((resolve) => {
            $httpClient.post({
                url: CONFIG.apiEndpoints.sku,
                headers: $request.headers,
                body: JSON.stringify({
                    itemId: userConfig.itemId,
                    sessionId: userConfig.sessionId
                })
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    resolve(false);
                    return;
                }

                try {
                    const json = JSON.parse(data);
                    if (json.success && json.data?.ticketPrices) {
                        const available = json.data.ticketPrices.some(t => 
                            t.priceId === userConfig.ticketPrice && t.stock > 0
                        );
                        resolve(available);
                    } else {
                        resolve(false);
                    }
                } catch (e) {
                    resolve(false);
                }
            });
        });
    }

    // 提交订单
    function submitOrder() {
        return new Promise((resolve) => {
            $httpClient.post({
                url: CONFIG.apiEndpoints.submit,
                headers: $request.headers,
                body: JSON.stringify({
                    itemId: userConfig.itemId,
                    sessionId: userConfig.sessionId,
                    priceId: userConfig.ticketPrice,
                    quantity: userConfig.quantity,
                    viewer: userConfig.viewer
                })
            }, (error, response, data) => {
                if (error || response.status !== 200) {
                    log("订单提交失败");
                    resolve(false);
                    return;
                }

                try {
                    const json = JSON.parse(data);
                    if (json.success) {
                        log("订单提交成功！请在APP中支付");
                        resolve(true);
                    } else {
                        log("订单提交失败: " + json.message);
                        resolve(false);
                    }
                } catch (e) {
                    log("订单提交出错: " + e.message);
                    resolve(false);
                }
            });
        });
    }

    // 主逻辑
    async function main() {
        // 获取抢票链接
        const link = $input.prompt({
            title: "输入抢票链接",
            message: "请粘贴大麦演出详情页链接",
            placeholder: "https://m.damai.cn/item.htm?id=123456"
        });

        if (!link) {
            log("未输入链接，脚本退出");
            return;
        }

        // 配置用户选择
        const configured = await promptUserSelection(link);
        if (!configured) return;

        // 开始轮询
        let retries = 0;
        while (retries < CONFIG.maxRetries) {
            log(`第${retries + 1}次检查票务状态...`);
            const hasStock = await checkTicketStatus();
            if (hasStock) {
                log("检测到有票！尝试提交订单...");
                const success = await submitOrder();
                if (success) {
                    break;
                }
            }
            await new Promise(resolve => setTimeout(resolve, CONFIG.pollingInterval));
            retries++;
        }

        if (retries >= CONFIG.maxRetries) {
            log("达到最大重试次数，脚本退出");
        }
    }

    // 启动脚本
    if ($request.url.includes("ticket")) {
        main();
    }
})();