const menuLinks = document.querySelectorAll(".sidebar a");

menuLinks.forEach(link => {
    link.addEventListener("click", function(event) {
        event.preventDefault();

        menuLinks.forEach(item => {
            item.classList.remove("active");
        });

        this.classList.add("active");

        console.log("Selected menu:", this.textContent);
    });
});

console.log("OLU-XMD Dashboard loaded!");
// Load customer wallet balance on dashboard
async function loadDashboardWallet() {
    try {
        const response = await fetch("/api/wallet");
        const result = await response.json();

        const balanceElement = document.getElementById("dashboardBalance");
        const transactionsElement = document.getElementById("recentTransactions");

        if (!response.ok) {
            if (balanceElement) balanceElement.textContent = "Login required";
            if (transactionsElement) transactionsElement.textContent = "Please login first.";
            return;
        }

        if (balanceElement) {
            balanceElement.textContent =
                "₦" + (result.balance / 100).toFixed(2);
        }

        if (transactionsElement) {
            transactionsElement.innerHTML = "";

            if (result.transactions.length === 0) {
                transactionsElement.textContent = "No transactions yet.";
            } else {
                result.transactions.slice(0, 3).forEach(transaction => {
                    const item = document.createElement("p");

                    item.textContent =
                        transaction.type + " — ₦" +
                        (transaction.amount / 100).toFixed(2) +
                        " — " + transaction.status.toUpperCase();

                    transactionsElement.appendChild(item);
                });
            }
        }

    } catch (error) {
        console.error("Dashboard wallet error:", error);
    }
}

loadDashboardWallet();