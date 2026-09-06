(function () {
    const tokenKey = "wellhealthAdminToken";

    const loginPanel = document.getElementById("login-panel");
    const dashboard = document.getElementById("dashboard");
    const loginForm = document.getElementById("login-form");
    const loginError = document.getElementById("login-error");
    const dashboardError = document.getElementById("dashboard-error");
    const logoutButton = document.getElementById("logout-button");
    const exportButton = document.getElementById("export-button");
    const periodSelect = document.getElementById("period-select");

    const totalUsers = document.getElementById("total-users");
    const activeSubscriptions = document.getElementById("active-subscriptions");
    const totalStars = document.getElementById("total-stars");
    const activeUsers = document.getElementById("active-users");
    const totalAnalyses = document.getElementById("total-analyses");
    const estimatedAiCost = document.getElementById("estimated-ai-cost");
    const estimatedAiCostPerUser = document.getElementById("estimated-ai-cost-per-user");
    const usersChart = document.getElementById("users-chart");
    const subscriptionsChart = document.getElementById("subscriptions-chart");
    const sourcesBody = document.getElementById("sources-body");
    const campaignForm = document.getElementById("campaign-form");
    const campaignSource = document.getElementById("campaign-source");
    const campaignLink = document.getElementById("campaign-link");
    const campaignStatus = document.getElementById("campaign-status");
    const copyLinkButton = document.getElementById("copy-link-button");
    const broadcastForm = document.getElementById("broadcast-form");
    const broadcastText = document.getElementById("broadcast-text");
    const broadcastCounter = document.getElementById("broadcast-counter");
    const broadcastSubmit = document.getElementById("broadcast-submit");
    const interviewPresetButton = document.getElementById("interview-preset-button");
    const broadcastStatus = document.getElementById("broadcast-status");
    const broadcastSubscribersLabel = document.getElementById("broadcast-subscribers-label");
    const broadcastAllLabel = document.getElementById("broadcast-all-label");
    const surveyLaunchForm = document.getElementById("survey-launch-form");
    const surveyLaunchSubmit = document.getElementById("survey-launch-submit");
    const surveyLaunchStatus = document.getElementById("survey-launch-status");
    const surveySubscribersLabel = document.getElementById("survey-subscribers-label");
    const surveyAllLabel = document.getElementById("survey-all-label");
    const surveyTotal = document.getElementById("survey-total");
    const surveyAvgApp = document.getElementById("survey-avg-app");
    const surveyAvgPhoto = document.getElementById("survey-avg-photo");
    const surveyPhotoSkipped = document.getElementById("survey-photo-skipped");
    const surveyAppDistribution = document.getElementById("survey-app-distribution");
    const surveyPhotoDistribution = document.getElementById("survey-photo-distribution");
    const surveyFeedbackList = document.getElementById("survey-feedback-list");
    const surveyExportButton = document.getElementById("survey-export-button");

    const numberFormatter = new Intl.NumberFormat("ru-RU");
    const usdFormatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });
    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
    });
    let latestStats = null;
    let broadcastPollTimer = null;
    const botUsername = (document.body.dataset.botUsername || "")
        .trim()
        .replace(/^@/, "");

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
            emptyCell.colSpan = 13;
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
                numberFormatter.format(row.profiles),
                numberFormatter.format(row.activated_24h),
                `${numberFormatter.format(row.d1_users)} (${numberFormatter.format(row.d1_pct)}%)`,
                `${numberFormatter.format(row.d7_users)} (${numberFormatter.format(row.d7_pct)}%)`,
                numberFormatter.format(row.paying_users),
                `${numberFormatter.format(row.stars)} ⭐`,
                `${numberFormatter.format(row.conversion_pct)}%`,
                `${numberFormatter.format(row.payment_conversion_pct)}%`,
                usdFormatter.format(row.spend_usd || 0),
                row.cost_per_activation_usd == null
                    ? "—"
                    : usdFormatter.format(row.cost_per_activation_usd),
                row.cost_per_paying_user_usd == null
                    ? "—"
                    : usdFormatter.format(row.cost_per_paying_user_usd),
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
        activeUsers.textContent = numberFormatter.format(data.totals.active_users);
        totalAnalyses.textContent = numberFormatter.format(data.totals.analyses);
        estimatedAiCost.textContent = usdFormatter.format(data.totals.estimated_ai_cost_usd);
        estimatedAiCostPerUser.textContent = data.totals.estimated_ai_cost_per_active_user_usd == null
            ? "нет активных пользователей"
            : `${usdFormatter.format(data.totals.estimated_ai_cost_per_active_user_usd)} на активного`;

        drawBarChart(usersChart, data.users_chart, {
            value: (point) => point.users,
        });
        drawBarChart(subscriptionsChart, data.subscriptions_chart, {
            value: (point) => point.subscriptions,
        });
        renderSources(data.sources || []);
        updateBroadcastAudienceLabels(data);
        fetchSurveyResults().catch(() => {
            setSurveyLaunchStatus("Не удалось загрузить результаты опроса.", "error");
        });
    }

    function updateBroadcastAudienceLabels(data) {
        const subscribers = numberFormatter.format(data.totals.active_subscriptions);
        const users = numberFormatter.format(data.totals.users);
        broadcastSubscribersLabel.textContent = `Подписчикам (${subscribers})`;
        broadcastAllLabel.textContent = `Всем (${users})`;
        surveySubscribersLabel.textContent = `Подписчикам (${subscribers})`;
        surveyAllLabel.textContent = `Всем (${users})`;
    }

    function normalizeCampaignSource(value) {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "")
            .slice(0, 64);
    }

    function updateCampaignLink() {
        const source = normalizeCampaignSource(campaignSource.value);
        campaignSource.value = source;
        campaignLink.value = botUsername && source
            ? `https://t.me/${botUsername}?start=${source}`
            : "";
        copyLinkButton.disabled = !campaignLink.value;
    }

    function setCampaignStatus(message, kind) {
        campaignStatus.textContent = message || "";
        campaignStatus.classList.toggle("is-error", kind === "error");
        campaignStatus.classList.toggle("is-success", kind === "success");
    }

    async function exportStatsCsv() {
        const token = getToken();
        if (!token) {
            showLogin();
            return;
        }
        const response = await fetch(`/admin/stats.csv?days=${periodSelect.value}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            throw new Error("Не удалось выгрузить CSV.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `taarelka-stats-${periodSelect.value}d.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function updateBroadcastCounter() {
        broadcastCounter.textContent = `${broadcastText.value.length} / 4096`;
    }

    function setBroadcastStatus(message, kind) {
        broadcastStatus.textContent = message || "";
        broadcastStatus.classList.toggle("is-error", kind === "error");
        broadcastStatus.classList.toggle("is-success", kind === "success");
    }

    function setSurveyLaunchStatus(message, kind) {
        surveyLaunchStatus.textContent = message || "";
        surveyLaunchStatus.classList.toggle("is-error", kind === "error");
        surveyLaunchStatus.classList.toggle("is-success", kind === "success");
    }

    function setSurveyBusy(isBusy) {
        surveyLaunchSubmit.disabled = isBusy;
        surveyLaunchForm.querySelectorAll("input[name='survey-audience']").forEach((input) => {
            input.disabled = isBusy;
        });
    }

    function selectedSurveyAudience() {
        const checked = surveyLaunchForm.querySelector("input[name='survey-audience']:checked");
        return checked ? checked.value : "me";
    }

    function confirmSurveyLaunch(audience) {
        if (audience === "me") {
            return true;
        }
        const count = audience === "subscribers"
            ? latestStats?.totals.active_subscriptions
            : latestStats?.totals.users;
        const label = audience === "subscribers" ? "подписчикам" : "всем пользователям";
        const countText = typeof count === "number" ? ` (${numberFormatter.format(count)})` : "";
        return window.confirm(`Отправить приглашение на опрос ${label}${countText}?`);
    }

    function formatRating(value) {
        if (value == null || Number.isNaN(Number(value))) {
            return "—";
        }
        return Number(value).toFixed(2);
    }

    function renderDistribution(target, distribution) {
        target.innerHTML = "";
        for (let rating = 1; rating <= 5; rating += 1) {
            const count = distribution?.[String(rating)] ?? distribution?.[rating] ?? 0;
            const item = document.createElement("li");
            item.textContent = `${rating}: ${numberFormatter.format(count)}`;
            target.appendChild(item);
        }
    }

    function renderSurveyResults(data) {
        surveyTotal.textContent = numberFormatter.format(data.total_responses || 0);
        surveyAvgApp.textContent = formatRating(data.avg_app_rating);
        surveyAvgPhoto.textContent = formatRating(data.avg_photo_rating);
        surveyPhotoSkipped.textContent = numberFormatter.format(data.photo_skipped || 0);
        renderDistribution(surveyAppDistribution, data.app_distribution || {});
        renderDistribution(surveyPhotoDistribution, data.photo_distribution || {});
        surveyFeedbackList.innerHTML = "";
        const feedback = data.recent_feedback || [];
        if (!feedback.length) {
            const empty = document.createElement("li");
            empty.className = "admin-muted";
            empty.textContent = "Пока нет текстовых ответов.";
            surveyFeedbackList.appendChild(empty);
            return;
        }
        feedback.forEach((row) => {
            const item = document.createElement("li");
            const photo = row.photo_rating == null ? "фото: —" : `фото: ${row.photo_rating}`;
            item.textContent = `#${row.user_id} · приложение: ${row.app_rating} · ${photo} — ${row.feedback_text}`;
            surveyFeedbackList.appendChild(item);
        });
    }

    async function fetchSurveyResults() {
        const token = getToken();
        if (!token) {
            return null;
        }
        const response = await fetch("/admin/survey/results", {
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
            throw new Error("Не удалось загрузить результаты опроса.");
        }
        const data = await response.json();
        renderSurveyResults(data);
        return data;
    }

    async function exportSurveyCsv() {
        const token = getToken();
        if (!token) {
            showLogin();
            return;
        }
        const response = await fetch("/admin/survey/export.csv", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            throw new Error("Не удалось выгрузить ответы опроса.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "taarelka-survey.csv";
        link.click();
        URL.revokeObjectURL(url);
    }

    function pollSurveyLaunchStatus(delay) {
        stopBroadcastPolling();
        broadcastPollTimer = setTimeout(async () => {
            try {
                const data = await fetchBroadcastStatus();
                if (!data) {
                    setSurveyBusy(false);
                    setBroadcastBusy(false);
                    return;
                }
                if (data.status === "running") {
                    setSurveyBusy(true);
                    setBroadcastBusy(true);
                    setSurveyLaunchStatus(formatBroadcastStatus(data));
                    pollSurveyLaunchStatus(800);
                    return;
                }
                setSurveyBusy(false);
                setBroadcastBusy(false);
                if (data.status === "error") {
                    setSurveyLaunchStatus(formatBroadcastStatus(data), "error");
                    return;
                }
                if (data.status === "done") {
                    setSurveyLaunchStatus(formatBroadcastStatus(data), "success");
                    await fetchSurveyResults();
                }
            } catch (error) {
                setSurveyBusy(false);
                setBroadcastBusy(false);
                setSurveyLaunchStatus(error.message || "Не удалось получить статус отправки.", "error");
            }
        }, delay || 400);
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
    interviewPresetButton.addEventListener("click", () => {
        broadcastText.value = (
            "Я улучшаю ТАРЕЛКУ и хочу понять ваш реальный опыт. "
            + "Если готовы на короткий 15-минутный разговор или несколько голосовых, "
            + "откройте /feedback и напишите «готов помочь». "
            + "Нужна честная обратная связь, продавать ничего не буду."
        );
        updateBroadcastCounter();
        broadcastText.focus();
    });

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

    surveyLaunchForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = getToken();
        if (!token) {
            showLogin();
            return;
        }

        const audience = selectedSurveyAudience();
        if (!confirmSurveyLaunch(audience)) {
            return;
        }

        setSurveyBusy(true);
        setBroadcastBusy(true);
        setSurveyLaunchStatus("Отправляем приглашения…");
        try {
            const response = await fetch("/admin/survey/launch", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ audience }),
            });

            if (response.status === 401) {
                clearToken();
                showLogin();
                setError(loginError, "Сессия истекла. Войдите снова.");
                setSurveyBusy(false);
                setBroadcastBusy(false);
                return;
            }
            if (response.status === 409) {
                setSurveyLaunchStatus("Рассылка уже идёт. Ждём завершения.", "error");
                pollSurveyLaunchStatus();
                return;
            }
            if (response.status === 503) {
                setSurveyBusy(false);
                setBroadcastBusy(false);
                setSurveyLaunchStatus("Бот-токен не задан на сервере анализатора.", "error");
                return;
            }
            if (!response.ok) {
                throw new Error("Не удалось запустить опрос.");
            }

            const data = await response.json();
            setSurveyLaunchStatus(formatBroadcastStatus(data));
            pollSurveyLaunchStatus();
        } catch (error) {
            setSurveyBusy(false);
            setBroadcastBusy(false);
            setSurveyLaunchStatus(error.message || "Не удалось запустить опрос.", "error");
        }
    });

    surveyExportButton.addEventListener("click", () => {
        exportSurveyCsv().catch((error) => {
            setSurveyLaunchStatus(error.message || "Не удалось выгрузить CSV.", "error");
        });
    });

    campaignSource.addEventListener("input", updateCampaignLink);
    campaignSource.addEventListener("blur", updateCampaignLink);

    copyLinkButton.addEventListener("click", async () => {
        if (!campaignLink.value) {
            return;
        }
        try {
            await navigator.clipboard.writeText(campaignLink.value);
            setCampaignStatus("Ссылка скопирована.", "success");
        } catch (error) {
            campaignLink.select();
            setCampaignStatus("Скопируйте выделенную ссылку.", "");
        }
    });

    campaignForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = getToken();
        const source = normalizeCampaignSource(campaignSource.value);
        if (!token) {
            showLogin();
            return;
        }
        if (!source) {
            setCampaignStatus("Введите корректную метку источника.", "error");
            return;
        }

        const formData = new FormData(campaignForm);
        setCampaignStatus("Сохраняем…");
        try {
            const response = await fetch(`/admin/campaigns/${encodeURIComponent(source)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    label: formData.get("label") || null,
                    spend_usd: Number(formData.get("spend_usd") || 0),
                    reach: Number(formData.get("reach") || 0),
                    notes: formData.get("notes") || null,
                }),
            });
            if (response.status === 401) {
                clearToken();
                showLogin();
                return;
            }
            if (!response.ok) {
                throw new Error("Не удалось сохранить эксперимент.");
            }
            setCampaignStatus("Эксперимент сохранён.", "success");
            await fetchStats();
        } catch (error) {
            setCampaignStatus(error.message || "Не удалось сохранить эксперимент.", "error");
        }
    });

    exportButton.addEventListener("click", () => {
        exportStatsCsv().catch((error) => {
            setError(dashboardError, error.message || "Не удалось выгрузить CSV.");
        });
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
    updateCampaignLink();
})();
