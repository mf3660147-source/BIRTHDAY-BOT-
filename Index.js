
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const Database = require('better-sqlite3');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const db = new Database(process.env.DB_PATH || './birthdays.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS birthdays (
    user_id TEXT PRIMARY KEY,
    ig_name TEXT NOT NULL,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS birthday_logs (
    user_id TEXT NOT NULL,
    birthday_date TEXT NOT NULL,
    PRIMARY KEY (user_id, birthday_date)
  );
`);

const commands = [
  new SlashCommandBuilder()
    .setName('birthdaysetup')
    .setDescription('Create the birthday registration message')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('birthdaylist')
    .setDescription('View registered birthdays (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

client.once('ready', async () => {
  console.log(`Birthday Bot online: ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Command registration failed:', error);
  }

  // Check birthdays every minute.
  setInterval(checkBirthdays, 60 * 1000);
  checkBirthdays();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'birthdaysetup') {
        if (!interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )) {
          return interaction.reply({
            content: '❌ Only server administrators can use this command.',
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🎂 Birthday Registration')
          .setDescription(
            'Celebrate your special day with us! 🎉\n\n' +
            'Click the button below and enter your birthday details ' +
            'and your in-game (IG) name. Confirm your details to register.'
          )
          .setFooter({ text: 'Birthday Bot • Registration System' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('birthday_register')
            .setLabel('🎂 Birthday Date')
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
          embeds: [embed],
          components: [row]
        });
      }

      if (interaction.commandName === 'birthdaylist') {
        if (!interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )) {
          return interaction.reply({
            content: '❌ This command is for administrators only.',
            ephemeral: true
          });
        }

        const rows = db.prepare(
          'SELECT user_id, ig_name, day, month, year FROM birthdays ORDER BY month, day'
        ).all();

        if (!rows.length) {
          return interaction.reply({
            content: '📋 No birthdays have been registered yet.',
            ephemeral: true
          });
        }

        const monthNames = [
          'January', 'February', 'March', 'April',
          'May', 'June', 'July', 'August',
          'September', 'October', 'November', 'December'
        ];

        // Discord embeds support at most 25 fields each.
        const embeds = [];

        for (let i = 0; i < rows.length; i += 25) {
          const page = rows.slice(i, i + 25);

          const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle(`🎂 Registered Birthdays (${rows.length})`)
            .setDescription('Admin-only birthday register');

          for (const person of page) {
            embed.addFields({
              name: `🎉 ${person.ig_name}`,
              value:
                `Discord: <@${person.user_id}>\n` +
                `Birthday: ${String(person.day).padStart(2, '0')} ` +
                `${monthNames[person.month - 1]} ${person.year}`,
              inline: false
            });
          }

          embed.setFooter({
            text: `Page ${Math.floor(i / 25) + 1} • Birthday Bot`
          });

          embeds.push(embed);
        }

        // Discord allows up to 10 embeds per message.
        // Send additional pages separately when the list is very large.
        await interaction.reply({
          embeds: embeds.slice(0, 10),
          ephemeral: true
        });

        for (let i = 10; i < embeds.length; i += 10) {
          await interaction.followUp({
            embeds: embeds.slice(i, i + 10),
            ephemeral: true
          });
        }
      }
    }

    if (interaction.isButton() &&
        interaction.customId === 'birthday_register') {
      const modal = new ModalBuilder()
        .setCustomId('birthday_modal')
        .setTitle('🎂 Register Your Birthday');

      const day = new TextInputBuilder()
        .setCustomId('day')
        .setLabel('Birthday Day (1–31)')
        .setPlaceholder('Example: 25')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2);

      const month = new TextInputBuilder()
        .setCustomId('month')
        .setLabel('Birthday Month (1–12)')
        .setPlaceholder('Example: 10 for October')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2);

      const year = new TextInputBuilder()
        .setCustomId('year')
        .setLabel('Birthday Year (YYYY)')
        .setPlaceholder('Example: 2005')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4);

      const igName = new TextInputBuilder()
        .setCustomId('ig_name')
        .setLabel('Your In-Game (IG) Name')
        .setPlaceholder('Enter your IG name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      modal.addComponents(
        new ActionRowBuilder().addComponents(day),
        new ActionRowBuilder().addComponents(month),
        new ActionRowBuilder().addComponents(year),
        new ActionRowBuilder().addComponents(igName)
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() &&
        interaction.customId === 'birthday_modal') {
      const d = Number(interaction.fields.getTextInputValue('day'));
      const m = Number(interaction.fields.getTextInputValue('month'));
      const y = Number(interaction.fields.getTextInputValue('year'));
      const igName = interaction.fields
        .getTextInputValue('ig_name')
        .trim();

      if (
        !Number.isInteger(d) ||
        !Number.isInteger(m) ||
        !Number.isInteger(y) ||
        y < 1900 ||
        y > new Date().getFullYear() ||
        m < 1 || m > 12 ||
        d < 1 || d > 31 ||
        !igName
      ) {
        return interaction.reply({
          content: '❌ Invalid details. Please check your birthday and IG name.',
          ephemeral: true
        });
      }

      const testDate = new Date(Date.UTC(y, m - 1, d));

      if (
        testDate.getUTCFullYear() !== y ||
        testDate.getUTCMonth() !== m - 1 ||
        testDate.getUTCDate() !== d
      ) {
        return interaction.reply({
          content: '❌ That date does not exist. Please enter a valid date.',
          ephemeral: true
        });
      }

      db.prepare(`
        INSERT INTO birthdays (user_id, ig_name, day, month, year)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          ig_name = excluded.ig_name,
          day = excluded.day,
          month = excluded.month,
          year = excluded.year
      `).run(interaction.user.id, igName, d, m, y);

      return interaction.reply({
        content:
          `✅ Birthday registered successfully!\n` +
          `🎂 Date: ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}\n` +
          `🎮 IG Name: ${igName}`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const message = {
      content: '❌ Something went wrong. Please try again later.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.reply(message).catch(() => {});
    }
  }
});

async function checkBirthdays() {
  const channelId = process.env.BIRTHDAY_CHANNEL_ID;
  if (!channelId || !client.isReady()) return;

  // Use India Standard Time.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const [year, month, day] = today.split('-').map(Number);

  const people = db.prepare(
    'SELECT user_id, ig_name FROM birthdays WHERE day = ? AND month = ?'
  ).all(day, month);

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased() || !channel.send) {
    console.error('Birthday channel not found or is not a text channel.');
    return;
  }

  for (const person of people) {
    const alreadySent = db.prepare(
      'SELECT 1 FROM birthday_logs WHERE user_id = ? AND birthday_date = ?'
    ).get(person.user_id, today);

    if (alreadySent) continue;

    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎉🎂 HAPPY BIRTHDAY! 🎂🎉')
      .setDescription(
        `Everyone, let's wish <@${person.user_id}> a very Happy Birthday! 🥳\n\n` +
        `🎮 **IG Name:** ${person.ig_name}\n\n` +
        '💖 May your special day be filled with happiness, success, ' +
        'and unforgettable memories. Have an amazing year ahead! 🎁🎈'
      )
      .setFooter({ text: 'Birthday Bot • Make every birthday special' })
      .setTimestamp();

    try {
      await channel.send({
        content: '@everyone',
        embeds: [embed],
        allowedMentions: { parse: ['everyone'], users: [person.user_id] }
      });

      db.prepare(
        'INSERT OR IGNORE INTO birthday_logs (user_id, birthday_date) VALUES (?, ?)'
      ).run(person.user_id, today);
    } catch (error) {
      console.error(`Birthday announcement failed for ${person.user_id}:`, error);
    }
  }
}

client.login(process.env.DISCORD_TOKEN);
