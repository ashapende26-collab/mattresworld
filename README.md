# Mattress World — Backend (Render)

This is the Node.js API server. Deploy it on [Render](https://render.com) (free tier works).

---

## Step 1 — Deploy to Render

1. Go to [render.com](https://render.com) and sign up / log in.
2. Click **New → Web Service**.
3. Upload this folder as a zip, or push it to a GitHub repo and connect that.
4. Render will auto-detect Node.js.
5. Set the **Start Command** to: `node server.js`
6. Set **Node Version** to `18` or higher.

---

## Step 2 — Set Environment Variables on Render

In your Render dashboard → **Environment** tab, add these:

| Key              | Value                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `ADMIN_USERNAME` | `admin` (or whatever you want)                                                                   |
| `ADMIN_PASSWORD` | A strong password you'll use to log in                                                           |
| `RECOVERY_CODE`  | A long secret — write it down somewhere safe                                                     |
| `SESSION_SECRET` | A random string (run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `FRONTEND_URL`   | Your Netlify URL, e.g. `https://your-site.netlify.app`                                           |
| `NODE_ENV`       | `production`                                                                                     |

---

## Step 3 — Note your Render URL

After deploy, Render gives you a URL like:

```
https://mattress-world-api.onrender.com
```

**Copy this URL** — you need it in the frontend setup.

---

## ⚠️ Important: Persistent Storage

Render's free tier **wipes the disk on every deploy or restart**. This means your `data/products.json` will reset.

To keep products saved:

- Upgrade to a paid Render plan with a **Persistent Disk**, OR
- Use a database (MongoDB Atlas free tier, etc.) — requires code changes.

For a simple test/demo, the free tier is fine.
