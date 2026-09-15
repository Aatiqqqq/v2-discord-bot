const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;

if (!TOKEN) {
  console.error("❌ Missing TOKEN environment variable.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "family.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultData = {
  config: {
    familyName: "Family Management Suite",
    accent: 0x5865f2,
    staffRoleId: "",
    announcementChannelId: "",
  },
  profiles: {},
  announcements: [],
  audit: [],
  stats: {
    applicationsApproved: 0,
    applicationsRejected: 0,
  },
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return structuredClone(defaultData);
    }
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      ...structuredClone(defaultData),
      ...raw,
      config: { ...defaultData.config, ...(raw.config || {}) },
      stats: { ...defaultData.stats, ...(raw.stats || {}) },
    };
  } catch (err) {
    console.error("❌ Database load error:", err);
    return structuredClone(defaultData);
  }
}

let db = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function isStaff(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  const roleId = db.config.staffRoleId;
  return Boolean(roleId && interaction.member?.roles?.cache?.has(roleId));
}

function staffOnly(interaction) {
  return isStaff(interaction);
}

function addAudit(interaction, action, details = "") {
  db.audit.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    details,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    timestamp: new Date().toISOString(),
  });
  db.audit = db.audit.slice(0, 500);
  saveData();
}

function getMemberProfile(member) {
  const p = db.profiles[member.id] || {};
  return {
    name: p.name || member.user.displayName || member.user.username,
    region: p.region || "Not set",
    ign: p.ign || "Not set",
    games: Array.isArray(p.games) ? p.games : [],
    notes: p.notes || "",
    joinedAt: member.joinedAt,
    updatedAt: p.updatedAt || null,
  };
}

function countGameMembers(guild) {
  const counts = {};
  for (const member of guild.members.cache.values()) {
    const p = db.profiles[member.id];
    if (!p?.games) continue;
    for (const game of p.games) counts[game] = (counts[game] || 0) + 1;
  }
  return counts;
}

function dashboardEmbed(guild) {
  const total = guild.memberCount;
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const humans = Math.max(0, total - bots);
  const profiles = Object.keys(db.profiles).length;
  const gameCounts = countGameMembers(guild);
  const approved = db.stats.applicationsApproved;
  const rejected = db.stats.applicationsRejected;
  const processed = approved + rejected;
  const approvalRate = processed ? `${Math.round((approved / processed) * 100)}%` : "—";

  return new EmbedBuilder()
    .setColor(db.config.accent)
    .setTitle(`⌘ ${db.config.familyName}`)
    .setDescription("**Operations Dashboard**\nA centralized overview of your Discord family/community.")
    .addFields(
      { name: "👥 Members", value: `**${humans}** humans\n${bots} bots`, inline: true },
      { name: "👤 Profiles", value: `**${profiles}** stored`, inline: true },
      { name: "🛡️ Staff", value: `**${db.config.staffRoleId ? `<@&${db.config.staffRoleId}>` : "Not configured"}**`, inline: true },
      { name: "🎮 VALORANT", value: `**${gameCounts.valorant || 0}**`, inline: true },
      { name: "🎮 Grand RP", value: `**${gameCounts.grandrp || 0}**`, inline: true },
      { name: "🎮 Fortnite", value: `**${gameCounts.fortnite || 0}**`, inline: true },
      { name: "📥 Applications Processed", value: `**${processed}**\n${approved} approved • ${rejected} rejected`, inline: true },
      { name: "📈 Approval Rate", value: `**${approvalRate}**`, inline: true },
      { name: "📢 Announcements", value: `**${db.announcements.length}** logged`, inline: true },
    )
    .setFooter({ text: "Family Management Suite • V2" })
    .setTimestamp();
}

function dashboardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("fm:stats").setLabel("Statistics").setEmoji("📊").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("fm:directory").setLabel("Member Directory").setEmoji("👥").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("fm:audit").setLabel("Audit Log").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("fm:profile").setLabel("My Profile").setEmoji("👤").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("fm:refresh").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Success),
    ),
  ];
}

function statsEmbed(guild) {
  const gameCounts = countGameMembers(guild);
  const humans = guild.members.cache.filter(m => !m.user.bot).size;
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const regions = {};
  for (const p of Object.values(db.profiles)) {
    if (p.region) regions[p.region] = (regions[p.region] || 0) + 1;
  }
  const topRegions = Object.entries(regions).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const regionText = topRegions.length
    ? topRegions.map(([r,n]) => `**${r}** — ${n}`).join("\n")
    : "No profile regions recorded.";

  const approved = db.stats.applicationsApproved;
  const rejected = db.stats.applicationsRejected;
  const totalProcessed = approved + rejected;
  const rate = totalProcessed ? Math.round((approved / totalProcessed) * 100) : 0;

  return new EmbedBuilder()
    .setColor(db.config.accent)
    .setTitle("📊 Family Statistics")
    .setDescription("Live Discord membership data combined with the suite's stored management data.")
    .addFields(
      { name: "Community", value: `👥 Humans: **${humans}**\n🤖 Bots: **${bots}**\n📋 Profiles: **${Object.keys(db.profiles).length}**`, inline: true },
      { name: "Games", value: `🔫 VALORANT: **${gameCounts.valorant || 0}**\n🫀 Grand RP: **${gameCounts.grandrp || 0}**\n🪓 Fortnite: **${gameCounts.fortnite || 0}**`, inline: true },
      { name: "Application Performance", value: `Approved: **${approved}**\nRejected: **${rejected}**\nApproval rate: **${rate}%**`, inline: true },
      { name: "🌍 Top Regions", value: regionText, inline: false },
    )
    .setFooter({ text: "Family Management Suite" })
    .setTimestamp();
}

function profileEmbed(member) {
  const p = getMemberProfile(member);
  return new EmbedBuilder()
    .setColor(db.config.accent)
    .setAuthor({ name: member.user.displayName, iconURL: member.user.displayAvatarURL() })
    .setTitle("👤 Family Profile")
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Identity", value: `**Name:** ${p.name}\n**Discord:** ${member}\n**User ID:** \`${member.id}\``, inline: true },
      { name: "Family Data", value: `**Region:** ${p.region}\n**In-Game Name:** ${p.ign}`, inline: true },
      { name: "🎮 Games", value: p.games.length ? p.games.map(g => `• ${g}`).join("\n") : "No games recorded.", inline: false },
      { name: "📅 Joined Server", value: p.joinedAt ? `<t:${Math.floor(p.joinedAt.getTime()/1000)}:F>` : "Unknown", inline: true },
      { name: "🕒 Profile Updated", value: p.updatedAt ? `<t:${Math.floor(new Date(p.updatedAt).getTime()/1000)}:R>` : "Never", inline: true },
    )
    .setFooter({ text: "Family Management Suite • Member Profile" })
    .setTimestamp();
}

function profileModal(userId) {
  return new ModalBuilder()
    .setCustomId(`fm:profilemodal:${userId}`)
    .setTitle("Update Family Profile")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Display / Real Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("region").setLabel("Region").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("ign").setLabel("In-Game Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("games").setLabel("Games (comma separated)").setPlaceholder("VALORANT, Grand RP, Fortnite").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(150)
      ),
    );
}

const commands = [
  new SlashCommandBuilder().setName("dashboard").setDescription("Open the Family Management dashboard."),
  new SlashCommandBuilder().setName("profile").setDescription("View a family member profile.")
    .addUserOption(o => o.setName("member").setDescription("Member to view").setRequired(false)),
  new SlashCommandBuilder().setName("stats").setDescription("View live family statistics."),
  new SlashCommandBuilder().setName("announce").setDescription("Publish a professional family announcement.")
    .addStringOption(o => o.setName("title").setDescription("Announcement title").setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName("message").setDescription("Announcement message").setRequired(true).setMaxLength(2000))
    .addChannelOption(o => o.setName("channel").setDescription("Target channel").setRequired(false))
    .addStringOption(o => o.setName("mention").setDescription("Mention policy")
      .addChoices(
        { name: "None", value: "none" },
        { name: "@here", value: "here" },
        { name: "@everyone", value: "everyone" },
      ).setRequired(false)),
  new SlashCommandBuilder().setName("set-config").setDescription("Configure the management suite.")
    .addStringOption(o => o.setName("setting").setDescription("Setting to change").setRequired(true)
      .addChoices(
        { name: "Family Name", value: "family_name" },
        { name: "Staff Role", value: "staff_role" },
        { name: "Announcement Channel", value: "announcement_channel" },
      ))
    .addStringOption(o => o.setName("value").setDescription("New value / ID").setRequired(true)),
  new SlashCommandBuilder().setName("set-profile").setDescription("Create or update a member profile.")
    .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("audit").setDescription("View recent management audit events."),
  new SlashCommandBuilder().setName("announce-history").setDescription("View recent announcement history."),
].map(c => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const app = express();
app.get("/", (req, res) => res.status(200).send("Family Management Suite V2 is online."));
app.get("/health", (req, res) => res.status(200).json({ status: "ok", service: "family-management-suite-v2" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Web server listening on port ${PORT}`));

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  if (CLIENT_ID) {
    try {
      const rest = new REST({ version: "10" }).setToken(TOKEN);
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Slash commands registered.");
    } catch (err) {
      console.error("❌ Slash command registration failed:", err);
    }
  } else {
    console.log("⚠️ CLIENT_ID not set. Slash commands were not registered automatically.");
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "dashboard") {
        return interaction.reply({ embeds: [dashboardEmbed(interaction.guild)], components: dashboardComponents(), flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === "stats") {
        return interaction.reply({ embeds: [statsEmbed(interaction.guild)], flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === "profile") {
        const user = interaction.options.getUser("member") || interaction.user;
        const member = await interaction.guild.members.fetch(user.id);
        return interaction.reply({ embeds: [profileEmbed(member)], flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === "set-profile") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser("member");
        return interaction.showModal(profileModal(user.id));
      }

      if (interaction.commandName === "announce") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const title = interaction.options.getString("title");
        const message = interaction.options.getString("message");
        const target = interaction.options.getChannel("channel") || (db.config.announcementChannelId ? interaction.guild.channels.cache.get(db.config.announcementChannelId) : interaction.channel);
        const mention = interaction.options.getString("mention") || "none";

        if (!target?.isTextBased()) return interaction.reply({ content: "❌ Target channel is not a text channel.", flags: MessageFlags.Ephemeral });

        const embed = new EmbedBuilder()
          .setColor(db.config.accent)
          .setTitle(`📢 ${title}`)
          .setDescription(message)
          .setFooter({ text: `${db.config.familyName} • Official Announcement` })
          .setTimestamp();

        const content = mention === "everyone" ? "@everyone" : mention === "here" ? "@here" : undefined;
        await target.send({ content, embeds: [embed], allowedMentions: { parse: mention === "none" ? [] : [mention] } });

        db.announcements.unshift({
          title, message, channelId: target.id,
          sentBy: interaction.user.id, sentAt: new Date().toISOString(),
        });
        db.announcements = db.announcements.slice(0, 200);
        addAudit(interaction, "Announcement published", `#${target.name} • ${title}`);

        return interaction.reply({ content: `✅ Announcement published in ${target}.`, flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === "set-config") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const setting = interaction.options.getString("setting");
        const value = interaction.options.getString("value").trim();

        if (setting === "family_name") db.config.familyName = value.slice(0, 80);
        if (setting === "staff_role") {
          if (!interaction.guild.roles.cache.has(value)) return interaction.reply({ content: "❌ That role ID was not found in this server.", flags: MessageFlags.Ephemeral });
          db.config.staffRoleId = value;
        }
        if (setting === "announcement_channel") {
          const ch = interaction.guild.channels.cache.get(value);
          if (!ch?.isTextBased()) return interaction.reply({ content: "❌ That channel ID is not a text channel.", flags: MessageFlags.Ephemeral });
          db.config.announcementChannelId = value;
        }

        saveData();
        addAudit(interaction, "Configuration updated", `${setting} = ${value}`);
        return interaction.reply({ content: "✅ Configuration updated.", flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === "audit") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const items = db.audit.slice(0, 10);
        const text = items.length
          ? items.map(x => `• <t:${Math.floor(new Date(x.timestamp).getTime()/1000)}:R> — **${x.action}**\n  ${x.details || "No details"} • ${x.userTag}`).join("\n")
          : "No audit events recorded yet.";
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(db.config.accent).setTitle("🛡️ Recent Audit Log").setDescription(text).setFooter({ text: "Staff only" })],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.commandName === "announce-history") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const items = db.announcements.slice(0, 10);
        const text = items.length
          ? items.map(x => `• <t:${Math.floor(new Date(x.sentAt).getTime()/1000)}:R> — **${x.title}** in <#${x.channelId}>`).join("\n")
          : "No announcements recorded yet.";
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(db.config.accent).setTitle("📢 Announcement History").setDescription(text)],
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (interaction.isButton()) {
      if (!interaction.customId.startsWith("fm:")) return;

      if (interaction.customId === "fm:stats") {
        return interaction.update({ embeds: [statsEmbed(interaction.guild)], components: dashboardComponents() });
      }

      if (interaction.customId === "fm:directory") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const members = interaction.guild.members.cache.filter(m => !m.user.bot).sort((a,b) => a.user.username.localeCompare(b.user.username)).first(15);
        const text = members.length
          ? members.map(m => `• ${m} — \`${m.user.username}\``).join("\n")
          : "No members found.";
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(db.config.accent).setTitle("👥 Member Directory").setDescription(text).setFooter({ text: "Showing first 15 members" })],
          components: dashboardComponents()
        });
      }

      if (interaction.customId === "fm:audit") {
        if (!staffOnly(interaction)) return interaction.reply({ content: "⛔ Staff permission required.", flags: MessageFlags.Ephemeral });
        const text = db.audit.slice(0, 10).map(x => `• <t:${Math.floor(new Date(x.timestamp).getTime()/1000)}:R> — **${x.action}**`).join("\n") || "No audit events recorded.";
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(db.config.accent).setTitle("🛡️ Audit Log").setDescription(text)],
          components: dashboardComponents()
        });
      }

      if (interaction.customId === "fm:profile") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        return interaction.update({ embeds: [profileEmbed(member)], components: dashboardComponents() });
      }

      if (interaction.customId === "fm:refresh") {
        return interaction.update({ embeds: [dashboardEmbed(interaction.guild)], components: dashboardComponents() });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("fm:profilemodal:")) {
      const targetId = interaction.customId.split(":")[2];
      const target = await interaction.guild.members.fetch(targetId);

      const games = interaction.fields.getTextInputValue("games")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

      db.profiles[targetId] = {
        name: interaction.fields.getTextInputValue("name"),
        region: interaction.fields.getTextInputValue("region"),
        ign: interaction.fields.getTextInputValue("ign"),
        games,
        updatedAt: new Date().toISOString(),
      };

      saveData();
      addAudit(interaction, "Member profile updated", `${target.user.tag} (${target.id})`);

      return interaction.reply({ content: `✅ Profile updated for ${target}.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong. Check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on("guildMemberRemove", member => {
  // Keep stored profile/history even after a member leaves.
  addAudit(
    { user: { id: client.user?.id || "system", tag: client.user?.tag || "system" } },
    "Member left server",
    `${member.user.tag} (${member.id})`
  );
});

client.on("error", err => {
  console.error("❌ Discord client error:", err);
});

client.login(TOKEN);
