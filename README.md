# Family Management Suite V2

Standalone Discord management bot. This project is intentionally separate from the existing Family Manager/verification bot.

## Included
- Professional `/dashboard`
- `/profile` and `/set-profile`
- `/stats`
- Staff-only `/announce`
- `/audit`
- `/announce-history`
- `/set-config`
- Persistent JSON database
- Render-compatible Express health server
- Interactive dashboard buttons
- Audit trail
- Game and region analytics

## Render
Build command:
npm install

Start command:
npm start

Environment variables:
- TOKEN = Discord bot token
- CLIENT_ID = Discord Application ID

## Discord permissions/intents
The bot needs the usual permissions to read the server and send embeds/messages.
Enable Server Members Intent in the Developer Portal.

## First setup
1. Invite the new bot to the server.
2. Set a staff role:
   /set-config setting:Staff Role value:<ROLE_ID>
3. Optionally set announcement channel:
   /set-config setting:Announcement Channel value:<CHANNEL_ID>
4. Set a family name:
   /set-config setting:Family Name value:<NAME>
5. Open:
   /dashboard

Data is stored in `data/family.json`.
