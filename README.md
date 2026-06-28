# Mattress World — Backend (Render)

## New in this version
- **MongoDB** — products stored permanently in the cloud (no more data loss on restart)
- **Cloudinary** — product images uploaded from your device and stored in the cloud
- **Sessions stored in MongoDB** — logins persist across server restarts

---

## Step 1 — Set up MongoDB Atlas (free)

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas) → sign up free
2. Create a **free M0 cluster**
3. Click **Connect** → **Drivers** → copy the connection string
4. It looks like: `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/`
5. Add `/mattressworld` at the end: `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/mattressworld`
6. Under **Network Access** → click **Add IP Address** → **Allow Access From Anywhere**

---

## Step 2 — Set up Cloudinary (free)

1. Go to [cloudinary.com](https://cloudinary.com) → sign up free
2. Go to your **Dashboard**
3. Copy your **Cloud Name**, **API Key**, and **API Secret**

---

## Step 3 — Set Environment Variables on Render

In Render dashboard → your service → **Environment** tab, set ALL of these:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/mattressworld` |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | from Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | from Cloudinary dashboard |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | your password |
| `RECOVERY_CODE` | a long secret phrase |
| `SESSION_SECRET` | a random string |
| `FRONTEND_URL` | `https://mattressworld.netlify.app` |
| `NODE_ENV` | `production` |

---

## Step 4 — Push to GitHub and deploy

Push this folder to your GitHub repo. Render auto-deploys.

Check the Render logs — you should see:
```
MongoDB connected
Admin account created: admin
Mattress World API running on port 3000
```
