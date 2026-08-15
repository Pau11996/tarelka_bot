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

    const numberFormatter = new Intl.NumberFormat("ru-RU");
    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
    });
    let latestStats = null;

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
        clearToken();
        showLogin();
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
