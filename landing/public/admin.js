(function () {
    const tokenKey = "wellhealthAdminToken";

    const loginPanel = document.getElementById("login-panel");
    const dashboard = document.getElementById("dashboard");
    const loginForm = document.getElementById("login-form");
    const loginError = document.getElementById("login-error");
    const dashboardError = document.getElementById("dashboard-error");
    const logoutButton = document.getElementById("logout-button");
    const periodSelect = document.getElementById("period-select");

    const totalUsers = document.getElementById("total-users");
    const activeSubscriptions = document.getElementById("active-subscriptions");
    const totalStars = document.getElementById("total-stars");
    const usersChart = document.getElementById("users-chart");
    const subscriptionsChart = document.getElementById("subscriptions-chart");
    const sourcesBody = document.getElementById("sources-body");
    const broadcastForm = document.getElementById("broadcast-form");
    const broadcastText = document.getElementById("broadcast-text");
    const broadcastCounter = document.getElementById("broadcast-counter");
    const broadcastSubmit = document.getElementById("broadcast-submit");
    const broadcastStatus = document.getElementById("broadcast-status");
    const broadcastSubscribersLabel = document.getElementById("broadcast-subscribers-label");
    const broadcastAllLabel = document.getElementById("broadcast-all-label");

    const numberFormatter = new Intl.NumberFormat("ru-RU");
    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
    });
    let latestStats = null;
    let broadcastPollTimer = null;

    function getToken() {
        return localStorage.getItem(tokenKey);
    }

    function setToken(token) {
        localStorage.setItem(tokenKey, token);
    }

    function clearToken() {
        localStorage.removeItem(tokenKey);
    }

    function showDashboard() {
        loginPanel.hidden = true;
        dashboard.hidden = false;
    }

    function showLogin() {
        dashboard.hidden = true;
        loginPanel.hidden = false;
    }

    function setError(element, message) {
        element.textContent = message || "";
    }

    function formatDate(value) {
        return dateFormatter.format(new Date(`${value}T00:00:00`));
    }

    function resizeCanvas(canvas) {
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        canvas.height = Math.max(1, Math.floor(rect.height * ratio));
        const context = canvas.getContext("2d");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { context, width: rect.width, height: rect.height };
    }

    function drawEmptyChart(canvas, label) {
        const { context, width, height } = resizeCanvas(canvas);
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#5f6f66";
        context.font = "15px Segoe UI, system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(label, width / 2, height / 2);
    }

    function drawBarChart(canvas, points, options) {
        if (!points.length) {
            drawEmptyChart(canvas, "Нет данных");
            return;
        }

        const { context, width, height } = resizeCanvas(canvas);
        const padding = { top: 18, right: 18, bottom: 42, left: 46 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        const values = points.map(options.value);
        const maxValue = Math.max(1, ...values);
        const barGap = Math.min(8, chartWidth / Math.max(points.length, 1) * 0.25);
        const barWidth = Math.max(2, (chartWidth - barGap * (points.length - 1)) / points.length);

        context.clearRect(0, 0, width, height);
        context.font = "12px Segoe UI, system-ui, sans-serif";
        context.textBaseline = "middle";

        context.strokeStyle = "#dce8df";
        context.fillStyle = "#5f6f66";
        context.lineWidth = 1;
        for (let index = 0; index <= 4; index += 1) {
            const y = padding.top + chartHeight - (chartHeight * index) / 4;
            const value = Math.round((maxValue * index) / 4);
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();
            context.textAlign = "right";
            context.fillText(numberFormatter.format(value), padding.left - 8, y);
        }

        context.fillStyle = "#1f9d55";
        points.forEach((point, index) => {
            const value = options.value(point);
            const x = padding.left + index * (barWidth + barGap);
            const barHeight = (value / maxValue) * chartHeight;
            const y = padding.top + chartHeight - barHeight;
            context.fillRect(x, y, barWidth, barHeight || 1);
        });

        context.fillStyle = "#5f6f66";
        context.textAlign = "center";
        const labelStep = Math.max(1, Math.ceil(points.length / 6));
        points.forEach((point, index) => {
            if (index % labelStep !== 0 && index !== points.length - 1) {
                return;
            }
            const x = padding.left + index * (barWidth + barGap) + barWidth / 2;
            context.fillText(formatDate(point.date), x, height - 18);
        });
    }

    function renderSources(sources) {
        sourcesBody.replaceChildren();
        if (!sources || !sources.length) {
            const emptyRow = document.createElement("tr");
            const emptyCell = document.createElement("td");
            emptyCell.colSpan = 5;
            emptyCell.className = "admin-muted";
            emptyCell.textContent = "Нет данных за период";
            emptyRow.appendChild(emptyCell);
            sourcesBody.appendChild(emptyRow);
            return;
        }

        sources.forEach((row) => {
            const tr = document.createElement("tr");
            const cells = [
                row.source === "direct" ? "без метки" : row.source,
                numberFormatter.format(row.users),
                numberFormatter.format(row.with_photo),
                numberFormatter.format(row.photo_24h),
                `${numberFormatter.format(row.conversion_pct)}%`,
            ];
            cells.forEach((value, index) => {
                const td = document.createElement("td");
                td.textContent = value;
                if (index === 0) {
                    td.className = "admin-source-name";
                }
                tr.appendChild(td);
            });
            sourcesBody.appendChild(tr);
        });
    }

    function renderStats(data) {
        latestStats = data;
        totalUsers.textContent = numberFormatter.format(data.totals.users);
        activeSubscriptions.textContent = numberFormatter.format(data.totals.active_subscriptions);
        totalStars.textContent = `${numberFormatter.format(data.totals.stars)} ⭐`;

        drawBarChart(usersChart, data.users_chart, {
            value: (point) => point.users,
        });
        drawBarChart(subscriptionsChart, data.subscriptions_chart, {
            value: (point) => point.subscriptions,
        });
        renderSources(data.sources || []);
        updateBroadcastAudienceLabels(data);
    }

    function updateBroadcastAudienceLabels(data) {
        const subscribers = numberFormatter.format(data.totals.active_subscriptions);
        const users = numberFormatter.format(data.totals.users);
        broadcastSubscribersLabel.textContent = `Подписчикам (${subscribers})`;
        broadcastAllLabel.textContent = `Всем (${users})`;
    }

    function updateBroadcastCounter() {
        broadcastCounter.textContent = `${broadcastText.value.length} / 4096`;
    }

    function setBroadcastStatus(message, kind) {
        broadcastStatus.textContent = message || "";
        broadcastStatus.classList.toggle("is-error", kind === "error");
        broadcastStatus.classList.toggle("is-success", kind === "success");
    }

    function formatBroadcastStatus(data) {
        const parts = [
            `Доставлено: ${numberFormatter.format(data.sent)}`,
            `заблокировали: ${numberFormatter.format(data.blocked)}`,
            `ошибки: ${numberFormatter.format(data.failed)}`,
        ];
        if (data.status === "running") {
            return `Отправка ${numberFormatter.format(data.sent + data.blocked + data.failed)} из ${numberFormatter.format(data.targeted)}. ${parts.join(", ")}.`;
        }
        if (data.status === "error") {
            return data.error || "Рассылка остановилась с ошибкой.";
        }
        return `${parts.join(". ")}. Всего в выборке: ${numberFormatter.format(data.targeted)}.`;
    }

    function stopBroadcastPolling() {
        if (broadcastPollTimer) {
            clearTimeout(broadcastPollTimer);
            broadcastPollTimer = null;
        }
    }

    function setBroadcastBusy(isBusy) {
        broadcastSubmit.disabled = isBusy;
        broadcastText.disabled = isBusy;
        broadcastForm.querySelectorAll("input[name='audience']").forEach((input) => {
            input.disabled = isBusy;
        });
    }

    async function fetchBroadcastStatus() {
        const token = getToken();
        if (!token) {
            return null;
        }
        const response = await fetch("/admin/broadcast", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (response.status === 401) {
            clearToken();
            showLogin();
            setError(loginError, "Сессия истекла. Войдите снова.");
            return null;
        }
        if (!response.ok) {
            throw new Error("Не удалось получить статус рассылки.");
        }
        return response.json();
    }

    function pollBroadcastStatus(delay) {
        stopBroadcastPolling();
        broadcastPollTimer = setTimeout(async () => {
            try {
                const data = await fetchBroadcastStatus();
                if (!data) {
                    setBroadcastBusy(false);
                    return;
                }
                if (data.status === "running") {
                    setBroadcastBusy(true);
                    setBroadcastStatus(formatBroadcastStatus(data));
                    pollBroadcastStatus(800);
                    return;
                }
                setBroadcastBusy(false);
                if (data.status === "error") {
                    setBroadcastStatus(formatBroadcastStatus(data), "error");
                    return;
                }
                if (data.status === "done") {
                    setBroadcastStatus(formatBroadcastStatus(data), "success");
                }
            } catch (error) {
                setBroadcastBusy(false);
                setBroadcastStatus(error.message || "Не удалось получить статус рассылки.", "error");
            }
        }, delay || 400);
    }

    function selectedAudience() {
        const checked = broadcastForm.querySelector("input[name='audience']:checked");
        return checked ? checked.value : "me";
    }

    function confirmBroadcast(audience) {
        if (audience === "me") {
            return true;
        }
        const count = audience === "subscribers"
            ? latestStats?.totals.active_subscriptions
            : latestStats?.totals.users;
        const label = audience === "subscribers" ? "подписчикам" : "всем пользователям";
        const countText = typeof count === "number" ? ` (${numberFormatter.format(count)})` : "";
        return window.confirm(`Отправить сообщение ${label}${countText}?`);
    }

    async function fetchStats() {
        const token = getToken();
        if (!token) {
            showLogin();
            return;
        }

        setError(dashboardError, "");
        const response = await fetch(`/admin/stats?days=${periodSelect.value}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            clearToken();
            showLogin();
            setError(loginError, "Сессия истекла. Войдите снова.");
            return;
        }
        if (!response.ok) {
            throw new Error("Не удалось загрузить статистику.");
        }

        renderStats(await response.json());
        showDashboard();
        updateBroadcastCounter();
        try {
            const broadcast = await fetchBroadcastStatus();
            if (broadcast && broadcast.status === "running") {
                setBroadcastBusy(true);
                setBroadcastStatus(formatBroadcastStatus(broadcast));
                pollBroadcastStatus();
            }
        } catch (error) {
            setBroadcastStatus(error.message || "Не удалось получить статус рассылки.", "error");
        }
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError(loginError, "");

        const formData = new FormData(loginForm);
        const response = await fetch("/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: formData.get("username"),
                password: formData.get("password"),
            }),
        });

        if (!response.ok) {
            setError(loginError, "Неверный логин или пароль.");
            return;
        }

        const data = await response.json();
        setToken(data.token);
        showDashboard();
        await fetchStats();
    });

    logoutButton.addEventListener("click", () => {
        stopBroadcastPolling();
        setBroadcastBusy(false);
        clearToken();
        showLogin();
    });

    broadcastText.addEventListener("input", updateBroadcastCounter);

    broadcastForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = getToken();
        if (!token) {
            showLogin();
            return;
        }

        const text = broadcastText.value.trim();
        const audience = selectedAudience();
        if (!text) {
            setBroadcastStatus("Введите текст сообщения.", "error");
            return;
        }
        if (!confirmBroadcast(audience)) {
            return;
        }

        setBroadcastBusy(true);
        setBroadcastStatus("Отправляем…");
        try {
            const response = await fetch("/admin/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ text, audience }),
            });

            if (response.status === 401) {
                clearToken();
                showLogin();
                setError(loginError, "Сессия истекла. Войдите снова.");
                setBroadcastBusy(false);
                return;
            }
            if (response.status === 409) {
                setBroadcastStatus("Рассылка уже идёт. Ждём завершения.", "error");
                pollBroadcastStatus();
                return;
            }
            if (response.status === 503) {
                setBroadcastBusy(false);
                setBroadcastStatus("Бот-токен не задан на сервере анализатора.", "error");
                return;
            }
            if (!response.ok) {
                throw new Error("Не удалось запустить рассылку.");
            }

            const data = await response.json();
            setBroadcastStatus(formatBroadcastStatus(data));
            pollBroadcastStatus();
        } catch (error) {
            setBroadcastBusy(false);
            setBroadcastStatus(error.message || "Не удалось запустить рассылку.", "error");
        }
    });

    periodSelect.addEventListener("change", () => {
        fetchStats().catch(() => {
            setError(dashboardError, "Не удалось обновить статистику.");
        });
    });

    window.addEventListener("resize", () => {
        if (latestStats) {
            renderStats(latestStats);
        }
    });

    if (getToken()) {
        showDashboard();
        fetchStats().catch(() => {
            setError(dashboardError, "Не удалось загрузить статистику.");
        });
    } else {
        showLogin();
    }
})();
