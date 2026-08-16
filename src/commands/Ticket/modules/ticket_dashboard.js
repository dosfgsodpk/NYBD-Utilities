```js
import { getColor } from '../../../config/bot.js';

import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, infoEmbed } from '../../../utils/embeds.js';
import {
    logger
} from '../../../utils/logger.js';

import {
    TitanBotError,
    ErrorTypes,
    replyUserError,
} from '../../../utils/errorHandler.js';

import {
    getGuildConfig,
    setGuildConfig,
} from '../../../services/config/guildConfig.js';

import {
    getGuildTicketStats,
} from '../../../utils/database/tickets.js';

import {
    getUserTicketCount,
} from '../../../services/ticket.js';

import {
    getTicketPanelStatus,
    messageHasButtonCustomId,
    formatPanelStatusField,
} from '../../../utils/panelStatus.js';

import {
    startDashboardSession,
} from '../../../utils/dashboardSession.js';


/* ================================================================
 * CONSTANTS
 * ================================================================ */

const TICKET_SELECT_ID = 'ticket_type_select';

const TICKET_TYPES = [
    {
        label: 'General Support',
        description: 'Get help with a general question or issue.',
        value: 'general_support',
        emoji: '🛠️',
    },
    {
        label: 'Billing',
        description: 'Questions about payments, purchases, or billing.',
        value: 'billing',
        emoji: '💰',
    },
    {
        label: 'Report a User',
        description: 'Report a user or behavior to the staff team.',
        value: 'report_user',
        emoji: '🚨',
    },
    {
        label: 'Partnership',
        description: 'Contact the staff team about a partnership.',
        value: 'partnership',
        emoji: '🤝',
    },
    {
        label: 'Other',
        description: 'Create a ticket for another reason.',
        value: 'other',
        emoji: '📩',
    },
];


/* ================================================================
 * TICKET PANEL
 * ================================================================ */

/**
 * Creates the ticket panel embed.
 */
function buildPanelEmbed(config) {
    return new EmbedBuilder()
        .setTitle('🎫 Support Tickets')
        .setDescription(
            config.ticketPanelMessage ||
            'Select the type of ticket you would like to create from the dropdown below.'
        )
        .setColor(getColor('info'));
}


/**
 * Creates the ticket type dropdown.
 *
 * This is used both by /ticket setup and by Repost Panel,
 * ensuring the bot never accidentally reposts the old button.
 */
function buildTicketTypeRow() {
    const select = new StringSelectMenuBuilder()
        .setCustomId(TICKET_SELECT_ID)
        .setPlaceholder('Select a ticket type...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            TICKET_TYPES.map((ticket) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(ticket.label)
                    .setDescription(ticket.description)
                    .setValue(ticket.value)
                    .setEmoji(ticket.emoji)
            )
        );

    return new ActionRowBuilder().addComponents(select);
}


/**
 * Reposts the live ticket panel.
 */
async function repostTicketPanel(
    client,
    guild,
    guildConfig,
    guildId
) {
    const channel = await guild.channels
        .fetch(guildConfig.ticketPanelChannelId)
        .catch(() => null);

    if (!channel) {
        throw new TitanBotError(
            'Panel channel missing',
            ErrorTypes.CONFIGURATION,
            'The configured ticket panel channel no longer exists. Set a new panel channel from the dashboard.'
        );
    }

    const sentPanel = await channel.send({
        embeds: [
            buildPanelEmbed(guildConfig),
        ],
        components: [
            buildTicketTypeRow(),
        ],
    });

    await persistPanelMessageId(
        client,
        guildId,
        guildConfig,
        sentPanel.id
    );

    return sentPanel;
}


/* ================================================================
 * CONFIGURATION HELPERS
 * ================================================================ */

async function persistPanelMessageId(
    client,
    guildId,
    guildConfig,
    messageId
) {
    if (
        !messageId ||
        guildConfig.ticketPanelMessageId === messageId
    ) {
        return;
    }

    guildConfig.ticketPanelMessageId = messageId;

    if (client.db) {
        await setGuildConfig(
            client,
            guildId,
            guildConfig
        );
    }
}


/**
 * Updates the actual ticket panel in Discord.
 */
async function updateLivePanel(
    client,
    guild,
    config,
    guildId
) {
    if (!config.ticketPanelChannelId) {
        return false;
    }

    try {
        const panelStatus =
            await getTicketPanelStatus(
                client,
                guild,
                config
            );

        if (panelStatus.recoveredId) {
            await persistPanelMessageId(
                client,
                guildId,
                config,
                panelStatus.recoveredId
            );
        }

        if (
            !panelStatus.exists ||
            !panelStatus.message
        ) {
            return false;
        }

        await panelStatus.message.edit({
            embeds: [
                buildPanelEmbed(config),
            ],
            components: [
                buildTicketTypeRow(),
            ],
        });

        return true;

    } catch (error) {
        logger.warn(
            'Failed to update live ticket panel:',
            error.message
        );

        return false;
    }
}


/* ================================================================
 * DASHBOARD BUTTONS
 * ================================================================ */

function buildButtonRow(
    guildConfig,
    guildId,
    disabled = false,
    panelStatus = null
) {
    const dmEnabled =
        guildConfig.dmOnClose !== false;

    const showRepost =
        panelStatus?.exists === false &&
        panelStatus?.reason === 'panel_deleted';

    const buttons = [];

    if (showRepost) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `ticket_cfg_repost_${guildId}`
                )
                .setLabel('Repost Panel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📌')
                .setDisabled(disabled)
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(
                `ticket_cfg_dm_toggle_${guildId}`
            )
            .setLabel('DM on Close')
            .setStyle(
                dmEnabled
                    ? ButtonStyle.Success
                    : ButtonStyle.Danger
            )
            .setEmoji(
                dmEnabled
                    ? '📬'
                    : '📭'
            )
            .setDisabled(disabled),

        new ButtonBuilder()
            .setCustomId(
                `ticket_cfg_staff_role_btn_${guildId}`
            )
            .setLabel('Staff Role')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🛡️')
            .setDisabled(disabled),

        new ButtonBuilder()
            .setCustomId(
                `ticket_cfg_delete_${guildId}`
            )
            .setLabel('Delete System')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
            .setDisabled(disabled)
    );

    return new ActionRowBuilder().addComponents(
        buttons
    );
}


/* ================================================================
 * DASHBOARD EMBED
 * ================================================================ */

function formatCloseDuration(ms) {
    if (ms == null) {
        return '`N/A`';
    }

    const hours = Math.floor(
        ms / 3_600_000
    );

    const minutes = Math.floor(
        (ms % 3_600_000) / 60_000
    );

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
}


function buildDashboardEmbed(
    config,
    guild,
    panelStatus = null,
    ticketStats = null
) {
    const panelChannel =
        config.ticketPanelChannelId
            ? `<#${config.ticketPanelChannelId}>`
            : '`Not set`';

    const staffRole =
        config.ticketStaffRoleId
            ? `<@&${config.ticketStaffRoleId}>`
            : '`Not set`';

    const ticketLogsChannel =
        config.ticketLogsChannelId
            ? `<#${config.ticketLogsChannelId}>`
            : '`Not set`';

    const transcriptChannel =
        config.ticketTranscriptChannelId
            ? `<#${config.ticketTranscriptChannelId}>`
            : '`Not set`';

    const openCategoryChannel =
        config.ticketCategoryId
            ? guild.channels.cache.get(
                config.ticketCategoryId
            )
            : null;

    const openCategory =
        openCategoryChannel
            ? openCategoryChannel.toString()
            : '`Not set`';

    const closedCategoryChannel =
        config.ticketClosedCategoryId
            ? guild.channels.cache.get(
                config.ticketClosedCategoryId
            )
            : null;

    const closedCategory =
        closedCategoryChannel
            ? closedCategoryChannel.toString()
            : '`Not set`';

    const rawMessage =
        config.ticketPanelMessage ||
        'Select the type of ticket you would like to create from the dropdown below.';

    const panelMessage =
        `\`${rawMessage.length > 60
            ? rawMessage.substring(0, 60) + '…'
            : rawMessage
        }\``;

    const panelStatusValue =
        formatPanelStatusField(
            panelStatus
        );

    const openTickets =
        ticketStats
            ? String(ticketStats.openCount)
            : '`—`';

    const avgCloseTime =
        ticketStats
            ? formatCloseDuration(
                ticketStats.avgCloseTimeMs
            )
            : '`—`';

    const feedbackSummary =
        ticketStats?.feedbackCount
            ? `${ticketStats.avgRating}/5 (${ticketStats.feedbackCount} rating${ticketStats.feedbackCount !== 1 ? 's' : ''})`
            : '`No ratings yet`';

    return new EmbedBuilder()
        .setTitle(
            '🎫 Ticket System Dashboard'
        )
        .setDescription(
            `Manage the ticket system for **${guild.name}**.\n\n` +
            `Select an option below to modify a setting.`
        )
        .setColor(getColor('info'))

        .addFields(
            {
                name: 'Panel Status',
                value: panelStatusValue,
                inline: false,
            },

            {
                name: 'Panel Channel',
                value: panelChannel,
                inline: true,
            },

            {
                name: 'Staff Role',
                value: staffRole,
                inline: true,
            },

            {
                name: '\u200B',
                value: '\u200B',
                inline: true,
            },

            {
                name: 'Open Tickets Category',
                value: openCategory,
                inline: true,
            },

            {
                name: 'Closed Tickets Category',
                value: closedCategory,
                inline: true,
            },

            {
                name: '\u200B',
                value: '\u200B',
                inline: true,
            },

            {
                name: 'Panel Message',
                value: panelMessage,
                inline: false,
            },

            {
                name: 'Max Tickets/User',
                value: String(
                    config.maxTicketsPerUser || 3
                ),
                inline: true,
            },

            {
                name: 'DM on Close',
                value:
                    config.dmOnClose !== false
                        ? 'Enabled'
                        : 'Disabled',
                inline: true,
            },

            {
                name: 'Ticket Logs Channel',
                value: ticketLogsChannel,
                inline: true,
            },

            {
                name: 'Transcript Channel',
                value: transcriptChannel,
                inline: true,
            },

            {
                name: '\u200B',
                value: '\u200B',
                inline: true,
            },

            {
                name: 'Open Tickets',
                value: openTickets,
                inline: true,
            },

            {
                name: 'Avg Close Time',
                value: avgCloseTime,
                inline: true,
            },

            {
                name: 'Feedback Rating',
                value: feedbackSummary,
                inline: true,
            },

            {
                name: 'Ticket Types',
                value:
                    '🛠️ General Support\n' +
                    '💰 Billing\n' +
                    '🚨 Report a User\n' +
                    '🤝 Partnership\n' +
                    '📩 Other',
                inline: false,
            }
        )

        .setFooter({
            text:
                'Select an option below • Dashboard closes after 10 minutes of inactivity',
        })

        .setTimestamp();
}


/* ================================================================
 * DASHBOARD SETTINGS MENU
 * ================================================================ */

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(
            `ticket_config_${guildId}`
        )
        .setPlaceholder(
            'Select a setting to configure...'
        )

        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Edit Panel Message'
                )
                .setDescription(
                    'Change the message displayed on the ticket panel.'
                )
                .setValue('panel_message')
                .setEmoji('📝'),

            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Change Open Tickets Category'
                )
                .setDescription(
                    'Category where new tickets are created.'
                )
                .setValue('open_category')
                .setEmoji('📁'),

            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Change Closed Tickets Category'
                )
                .setDescription(
                    'Category where closed tickets are moved.'
                )
                .setValue('closed_category')
                .setEmoji('📂'),

            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Set Max Tickets per User'
                )
                .setDescription(
                    'Limit how many open tickets a user can have.'
                )
                .setValue('max_tickets')
                .setEmoji('🔢'),

            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Set Ticket Logs Channel'
                )
                .setDescription(
                    'Channel for ticket lifecycle events and logs.'
                )
                .setValue('logs_channel')
                .setEmoji('🎫'),

            new StringSelectMenuOptionBuilder()
                .setLabel(
                    'Set Transcript Channel'
                )
                .setDescription(
                    'Channel where deleted ticket transcripts are sent.'
                )
                .setValue('transcript_channel')
                .setEmoji('📜')
        );
}


/* ================================================================
 * DASHBOARD REFRESH
 * ================================================================ */

async function refreshDashboard(
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    const panelStatus =
        await getTicketPanelStatus(
            client,
            rootInteraction.guild,
            guildConfig
        );

    const ticketStats =
        await getGuildTicketStats(
            guildId
        );

    if (panelStatus?.recoveredId) {
        await persistPanelMessageId(
            client,
            guildId,
            guildConfig,
            panelStatus.recoveredId
        );
    }

    const buttonRow =
        buildButtonRow(
            guildConfig,
            guildId,
            false,
            panelStatus
        );

    const selectRow =
        new ActionRowBuilder().addComponents(
            buildSelectMenu(guildId)
        );

    await InteractionHelper.safeEditReply(
        rootInteraction,
        {
            embeds: [
                buildDashboardEmbed(
                    guildConfig,
                    rootInteraction.guild,
                    panelStatus,
                    ticketStats
                ),
            ],

            components: [
                buttonRow,
                selectRow,
            ],
        }
    ).catch(() => {});
}


/* ================================================================
 * MAIN DASHBOARD
 * ================================================================ */

export default {
    prefixOnly: false,

    async execute(
        interaction,
        config,
        client
    ) {
        try {
            const guildId =
                interaction.guild.id;

            const guildConfig =
                await getGuildConfig(
                    client,
                    guildId
                );

            if (
                !guildConfig?.ticketPanelChannelId
            ) {
                throw new TitanBotError(
                    'Ticket system not configured',
                    ErrorTypes.CONFIGURATION,
                    'The ticket system has not been set up yet. Run `/ticket setup` first.'
                );
            }

            const panelStatus =
                await getTicketPanelStatus(
                    client,
                    interaction.guild,
                    guildConfig
                );

            if (panelStatus.recoveredId) {
                await persistPanelMessageId(
                    client,
                    guildId,
                    guildConfig,
                    panelStatus.recoveredId
                );
            }

            const ticketStats =
                await getGuildTicketStats(
                    guildId
                );

            const selectRow =
                new ActionRowBuilder().addComponents(
                    buildSelectMenu(guildId)
                );

            const buttonRow =
                buildButtonRow(
                    guildConfig,
                    guildId,
                    false,
                    panelStatus
                );

            await startDashboardSession({
                interaction,

                embeds: [
                    buildDashboardEmbed(
                        guildConfig,
                        interaction.guild,
                        panelStatus,
                        ticketStats
                    ),
                ],

                components: [
                    buttonRow,
                    selectRow,
                ],

                selectMenuId:
                    `ticket_config_${guildId}`,

                buttonMatcher:
                    (customId) =>
                        customId ===
                            `ticket_cfg_repost_${guildId}` ||
                        customId ===
                            `ticket_cfg_dm_toggle_${guildId}` ||
                        customId ===
                            `ticket_cfg_staff_role_btn_${guildId}` ||
                        customId ===
                            `ticket_cfg_delete_${guildId}`,

                onSelect:
                    async (
                        selectInteraction
                    ) => {
                        const selectedOption =
                            selectInteraction.values[0];

                        switch (
                            selectedOption
                        ) {
                            case 'panel_message':
                                await handlePanelMessage(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            case 'open_category':
                                await handleOpenCategory(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            case 'closed_category':
                                await handleClosedCategory(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            case 'max_tickets':
                                await handleMaxTickets(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            case 'logs_channel':
                                await handleLogsChannel(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            case 'transcript_channel':
                                await handleTranscriptChannel(
                                    selectInteraction,
                                    interaction,
                                    guildConfig,
                                    guildId,
                                    client
                                );
                                break;

                            default:
                                await selectInteraction.reply({
                                    content:
                                        'Unknown dashboard option.',
                                    flags:
                                        MessageFlags.Ephemeral,
                                });
                        }
                    },

                onButton:
                    async (
                        btnInteraction
                    ) => {
                        if (
                            btnInteraction.customId ===
                            `ticket_cfg_repost_${guildId}`
                        ) {
                            await handleRepostPanel(
                                btnInteraction,
                                interaction,
                                guildConfig,
                                guildId,
                                client
                            );
                        }

                        else if (
                            btnInteraction.customId ===
                            `ticket_cfg_dm_toggle_${guildId}`
                        ) {
                            await handleDmOnClose(
                                btnInteraction,
                                interaction,
                                guildConfig,
                                guildId,
                                client
                            );
                        }

                        else if (
                            btnInteraction.customId ===
                            `ticket_cfg_staff_role_btn_${guildId}`
                        ) {
                            await handleStaffRole(
                                btnInteraction,
                                interaction,
                                guildConfig,
                                guildId,
                                client
                            );
                        }

                        else if (
                            btnInteraction.customId ===
                            `ticket_cfg_delete_${guildId}`
                        ) {
                            await handleDeleteSystem(
                                btnInteraction,
                                interaction,
                                guildConfig,
                                guildId,
                                client
                            );
                        }
                    },
            });

        } catch (error) {
            if (
                error instanceof TitanBotError
            ) {
                throw error;
            }

            logger.error(
                'Unexpected error in ticket_config:',
                error
            );

            throw new TitanBotError(
                `Ticket config failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the ticket configuration dashboard.'
            );
        }
    },
};


/* ================================================================
 * EDIT PANEL MESSAGE
 * ================================================================ */

async function handlePanelMessage(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'ticket_cfg_panel_msg'
            )
            .setTitle(
                '📝 Edit Panel Message'
            )
            .addComponents(
                new ActionRowBuilder()
                    .addComponents(
                        new TextInputBuilder()
                            .setCustomId(
                                'panel_msg_input'
                            )
                            .setLabel(
                                'Panel Message'
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setValue(
                                guildConfig.ticketPanelMessage ||
                                'Select the type of ticket you would like to create from the dropdown below.'
                            )
                            .setMaxLength(2000)
                            .setMinLength(1)
                            .setRequired(true)
                            .setPlaceholder(
                                'Select the type of ticket you would like to create from the dropdown below.'
                            )
                    )
            );

    await selectInteraction.showModal(
        modal
    );

    const submitted =
        await selectInteraction
            .awaitModalSubmit({
                filter:
                    (i) =>
                        i.customId ===
                            'ticket_cfg_panel_msg' &&
                        i.user.id ===
                            selectInteraction.user.id,

                time: 120_000,
            })
            .catch(() => null);

    if (!submitted) {
        return;
    }

    const newMessage =
        submitted.fields
            .getTextInputValue(
                'panel_msg_input'
            )
            .trim();

    guildConfig.ticketPanelMessage =
        newMessage;

    await setGuildConfig(
        client,
        guildId,
        guildConfig
    );

    const panelUpdated =
        await updateLivePanel(
            client,
            rootInteraction.guild,
            guildConfig,
            guildId
        );

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Panel Message Updated',
                `The ticket panel message has been updated.${
                    panelUpdated
                        ? '\nThe live ticket panel has also been refreshed.'
                        : '\n\n> **Note:** The live panel could not be located. Use **Repost Panel** from the dashboard.'
                }`
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });

    await refreshDashboard(
        rootInteraction,
        guildConfig,
        guildId,
        client
    );
}


/* ================================================================
 * STAFF ROLE
 * ================================================================ */

async function handleStaffRole(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await selectInteraction.deferUpdate();

    const roleSelect =
        new RoleSelectMenuBuilder()
            .setCustomId(
                'ticket_cfg_staff_role'
            )
            .setPlaceholder(
                'Select the staff role...'
            )
            .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '🛡️ Change Staff Role'
                )
                .setDescription(
                    `**Current:** ${
                        guildConfig.ticketStaffRoleId
                            ? `<@&${guildConfig.ticketStaffRoleId}>`
                            : '`Not set`'
                    }\n\nSelect the role that should have access to manage tickets.`
                )
                .setColor(
                    getColor('info')
                ),
        ],

        components: [
            new ActionRowBuilder()
                .addComponents(
                    roleSelect
                ),
        ],

        flags:
            MessageFlags.Ephemeral,
    });

    const collector =
        rootInteraction.channel.createMessageComponentCollector({
            componentType:
                ComponentType.RoleSelect,

            filter:
                (i) =>
                    i.user.id ===
                        selectInteraction.user.id &&
                    i.customId ===
                        'ticket_cfg_staff_role',

            time: 60_000,
            max: 1,
        });

    collector.on(
        'collect',
        async (roleInteraction) => {
            await roleInteraction.deferUpdate();

            const role =
                roleInteraction.roles.first();

            if (!role) {
                return;
            }

            guildConfig.ticketStaffRoleId =
                role.id;

            await setGuildConfig(
                client,
                guildId,
                guildConfig
            );

            await roleInteraction.followUp({
                embeds: [
                    successEmbed(
                        'Staff Role Updated',
                        `Staff role set to ${role}.`
                    ),
                ],
                flags:
                    MessageFlags.Ephemeral,
            });

            await refreshDashboard(
                rootInteraction,
                guildConfig,
                guildId,
                client
            );
        }
    );
}


/* ================================================================
 * OPEN CATEGORY
 * ================================================================ */

async function handleOpenCategory(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await selectInteraction.deferUpdate();

    const channelSelect =
        new ChannelSelectMenuBuilder()
            .setCustomId(
                'ticket_cfg_open_cat'
            )
            .setPlaceholder(
                'Select a category...'
            )
            .addChannelTypes(
                ChannelType.GuildCategory
            )
            .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '📁 Change Open Tickets Category'
                )
                .setDescription(
                    `**Current:** ${
                        guildConfig.ticketCategoryId
                            ? `<#${guildConfig.ticketCategoryId}>`
                            : '`Not set`'
                    }\n\nSelect the category where new tickets will be created.`
                )
                .setColor(
                    getColor('info')
                ),
        ],

        components: [
            new ActionRowBuilder()
                .addComponents(
                    channelSelect
                ),
        ],

        flags:
            MessageFlags.Ephemeral,
    });

    const collector =
        rootInteraction.channel.createMessageComponentCollector({
            componentType:
                ComponentType.ChannelSelect,

            filter:
                (i) =>
                    i.user.id ===
                        selectInteraction.user.id &&
                    i.customId ===
                        'ticket_cfg_open_cat',

            time: 60_000,
            max: 1,
        });

    collector.on(
        'collect',
        async (channelInteraction) => {
            await channelInteraction.deferUpdate();

            const category =
                channelInteraction.channels.first();

            if (!category) {
                return;
            }

            guildConfig.ticketCategoryId =
                category.id;

            await setGuildConfig(
                client,
                guildId,
                guildConfig
            );

            await channelInteraction.followUp({
                embeds: [
                    successEmbed(
                        'Open Category Updated',
                        `New tickets will now be created in **${category.name}**.`
                    ),
                ],
                flags:
                    MessageFlags.Ephemeral,
            });

            await refreshDashboard(
                rootInteraction,
                guildConfig,
                guildId,
                client
            );
        }
    );
}


/* ================================================================
 * CLOSED CATEGORY
 * ================================================================ */

async function handleClosedCategory(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await selectInteraction.deferUpdate();

    const channelSelect =
        new ChannelSelectMenuBuilder()
            .setCustomId(
                'ticket_cfg_closed_cat'
            )
            .setPlaceholder(
                'Select a category...'
            )
            .addChannelTypes(
                ChannelType.GuildCategory
            )
            .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '📂 Change Closed Tickets Category'
                )
                .setDescription(
                    `**Current:** ${
                        guildConfig.ticketClosedCategoryId
                            ? `<#${guildConfig.ticketClosedCategoryId}>`
                            : '`Not set`'
                    }\n\nSelect the category where closed tickets will be moved.`
                )
                .setColor(
                    getColor('info')
                ),
        ],

        components: [
            new ActionRowBuilder()
                .addComponents(
                    channelSelect
                ),
        ],

        flags:
            MessageFlags.Ephemeral,
    });

    const collector =
        rootInteraction.channel.createMessageComponentCollector({
            componentType:
                ComponentType.ChannelSelect,

            filter:
                (i) =>
                    i.user.id ===
                        selectInteraction.user.id &&
                    i.customId ===
                        'ticket_cfg_closed_cat',

            time: 60_000,
            max: 1,
        });

    collector.on(
        'collect',
        async (channelInteraction) => {
            await channelInteraction.deferUpdate();

            const category =
                channelInteraction.channels.first();

            if (!category) {
                return;
            }

            guildConfig.ticketClosedCategoryId =
                category.id;

            await setGuildConfig(
                client,
                guildId,
                guildConfig
            );

            await channelInteraction.followUp({
                embeds: [
                    successEmbed(
                        'Closed Category Updated',
                        `Closed tickets will now be moved to **${category.name}**.`
                    ),
                ],
                flags:
                    MessageFlags.Ephemeral,
            });

            await refreshDashboard(
                rootInteraction,
                guildConfig,
                guildId,
                client
            );
        }
    );
}


/* ================================================================
 * MAX TICKETS
 * ================================================================ */

async function handleMaxTickets(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'ticket_cfg_max_tickets'
            )
            .setTitle(
                'Set Max Tickets per User'
            )
            .addComponents(
                new ActionRowBuilder()
                    .addComponents(
                        new TextInputBuilder()
                            .setCustomId(
                                'max_tickets_input'
                            )
                            .setLabel(
                                'Max Open Tickets (1–10)'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setValue(
                                String(
                                    guildConfig.maxTicketsPerUser ||
                                    3
                                )
                            )
                            .setMaxLength(2)
                            .setMinLength(1)
                            .setRequired(true)
                            .setPlaceholder('3')
                    )
            );

    await selectInteraction.showModal(
        modal
    );

    const submitted =
        await selectInteraction
            .awaitModalSubmit({
                filter:
                    (i) =>
                        i.customId ===
                            'ticket_cfg_max_tickets' &&
                        i.user.id ===
                            selectInteraction.user.id,

                time: 120_000,
            })
            .catch(() => null);

    if (!submitted) {
        return;
    }

    const raw =
        submitted.fields
            .getTextInputValue(
                'max_tickets_input'
            )
            .trim();

    const newMax =
        parseInt(raw, 10);

    if (
        Number.isNaN(newMax) ||
        newMax < 1 ||
        newMax > 10
    ) {
        await replyUserError(
            submitted,
            {
                type:
                    ErrorTypes.VALIDATION,

                message:
                    'Max tickets must be a whole number between **1** and **10**.',
            }
        );

        return;
    }

    guildConfig.maxTicketsPerUser =
        newMax;

    await setGuildConfig(
        client,
        guildId,
        guildConfig
    );

    await submitted.reply({
        embeds: [
            successEmbed(
                'Max Tickets Updated',
                `Users can now have at most **${newMax}** open ticket${newMax !== 1 ? 's' : ''} at a time.`
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });

    await refreshDashboard(
        rootInteraction,
        guildConfig,
        guildId,
        client
    );
}


/* ================================================================
 * DM ON CLOSE
 * ================================================================ */

async function handleDmOnClose(
    btnInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await btnInteraction.deferUpdate();

    const newState =
        guildConfig.dmOnClose === false;

    guildConfig.dmOnClose =
        newState;

    await setGuildConfig(
        client,
        guildId,
        guildConfig
    );

    await btnInteraction.followUp({
        embeds: [
            successEmbed(
                'DM on Close Updated',
                `Users will **${
                    newState
                        ? 'now'
                        : 'no longer'
                }** receive a DM when their ticket is closed.`
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });

    await refreshDashboard(
        rootInteraction,
        guildConfig,
        guildId,
        client
    );
}


/* ================================================================
 * LOGS CHANNEL
 * ================================================================ */

async function handleLogsChannel(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await selectInteraction.deferUpdate();

    const channelSelect =
        new ChannelSelectMenuBuilder()
            .setCustomId(
                'ticket_cfg_logs_channel'
            )
            .setPlaceholder(
                'Select a channel...'
            )
            .addChannelTypes(
                ChannelType.GuildText
            )
            .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '🎫 Select Ticket Logs Channel'
                )
                .setDescription(
                    'Choose where ticket feedback, lifecycle events, and other ticket logs will be sent.'
                )
                .setColor(
                    getColor('info')
                ),
        ],

        components: [
            new ActionRowBuilder()
                .addComponents(
                    channelSelect
                ),
        ],

        flags:
            MessageFlags.Ephemeral,
    });

    const collector =
        rootInteraction.channel.createMessageComponentCollector({
            componentType:
                ComponentType.ChannelSelect,

            filter:
                (i) =>
                    i.user.id ===
                        selectInteraction.user.id &&
                    i.customId ===
                        'ticket_cfg_logs_channel',

            time: 60_000,
            max: 1,
        });

    collector.on(
        'collect',
        async (channelInteraction) => {
            await channelInteraction.deferUpdate();

            const channel =
                channelInteraction.channels.first();

            if (!channel) {
                return;
            }

            guildConfig.ticketLogsChannelId =
                channel.id;

            await setGuildConfig(
                client,
                guildId,
                guildConfig
            );

            await channelInteraction.followUp({
                embeds: [
                    successEmbed(
                        'Logs Channel Updated',
                        `Ticket logs will be sent to ${channel}.`
                    ),
                ],
                flags:
                    MessageFlags.Ephemeral,
            });

            await refreshDashboard(
                rootInteraction,
                guildConfig,
                guildId,
                client
            );
        }
    );
}


/* ================================================================
 * TRANSCRIPT CHANNEL
 * ================================================================ */

async function handleTranscriptChannel(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await selectInteraction.deferUpdate();

    const channelSelect =
        new ChannelSelectMenuBuilder()
            .setCustomId(
                'ticket_cfg_transcript_channel'
            )
            .setPlaceholder(
                'Select a channel...'
            )
            .addChannelTypes(
                ChannelType.GuildText
            )
            .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '📜 Select Transcript Channel'
                )
                .setDescription(
                    'Choose where auto-generated transcripts will be sent when tickets are deleted.'
                )
                .setColor(
                    getColor('info')
                ),
        ],

        components: [
            new ActionRowBuilder()
                .addComponents(
                    channelSelect
                ),
        ],

        flags:
            MessageFlags.Ephemeral,
    });

    const collector =
        rootInteraction.channel.createMessageComponentCollector({
            componentType:
                ComponentType.ChannelSelect,

            filter:
                (i) =>
                    i.user.id ===
                        selectInteraction.user.id &&
                    i.customId ===
                        'ticket_cfg_transcript_channel',

            time: 60_000,
            max: 1,
        });

    collector.on(
        'collect',
        async (channelInteraction) => {
            await channelInteraction.deferUpdate();

            const channel =
                channelInteraction.channels.first();

            if (!channel) {
                return;
            }

            guildConfig.ticketTranscriptChannelId =
                channel.id;

            await setGuildConfig(
                client,
                guildId,
                guildConfig
            );

            await channelInteraction.followUp({
                embeds: [
                    successEmbed(
                        'Transcript Channel Updated',
                        `Transcripts will be sent to ${channel}.`
                    ),
                ],
                flags:
                    MessageFlags.Ephemeral,
            });

            await refreshDashboard(
                rootInteraction,
                guildConfig,
                guildId,
                client
            );
        }
    );
}


/* ================================================================
 * REPOST PANEL
 * ================================================================ */

async function handleRepostPanel(
    btnInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    await btnInteraction.deferUpdate();

    const panelStatus =
        await getTicketPanelStatus(
            client,
            rootInteraction.guild,
            guildConfig
        );

    if (panelStatus.exists) {
        await btnInteraction.followUp({
            embeds: [
                infoEmbed(
                    'Panel Already Active',
                    'The ticket panel is already posted in the configured channel.'
                ),
            ],
            flags:
                MessageFlags.Ephemeral,
        });

        await refreshDashboard(
            rootInteraction,
            guildConfig,
            guildId,
            client
        );

        return;
    }

    const sentPanel =
        await repostTicketPanel(
            client,
            rootInteraction.guild,
            guildConfig,
            guildId
        );

    await btnInteraction.followUp({
        embeds: [
            successEmbed(
                'Panel Reposted',
                `A new ticket panel was posted in <#${guildConfig.ticketPanelChannelId}>.${
                    sentPanel.url
                        ? `\n[Open panel message](${sentPanel.url})`
                        : ''
                }`
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });

    await refreshDashboard(
        rootInteraction,
        guildConfig,
        guildId,
        client
    );
}


/* ================================================================
 * DELETE SYSTEM
 * ================================================================ */

async function handleDeleteSystem(
    btnInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client
) {
    const deleteModal =
        new ModalBuilder()
            .setCustomId(
                'ticket_delete_confirm_modal'
            )
            .setTitle(
                'Delete Ticket System'
            )
            .addComponents(
                new ActionRowBuilder()
                    .addComponents(
                        new TextInputBuilder()
                            .setCustomId(
                                'delete_confirmation'
                            )
                            .setLabel(
                                'Type "DELETE" to confirm'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                'DELETE'
                            )
                            .setMaxLength(6)
                            .setMinLength(6)
                            .setRequired(true)
                    )
            );

    await btnInteraction.showModal(
        deleteModal
    );

    const submitted =
        await btnInteraction
            .awaitModalSubmit({
                filter:
                    (i) =>
                        i.customId ===
                            'ticket_delete_confirm_modal' &&
                        i.user.id ===
                            btnInteraction.user.id,

                time: 120_000,
            })
            .catch(() => null);

    if (!submitted) {
        await refreshDashboard(
            rootInteraction,
            guildConfig,
            guildId,
            client
        );

        return;
    }

    const confirmation =
        submitted.fields
            .getTextInputValue(
                'delete_confirmation'
            )
            .trim();

    if (confirmation !== 'DELETE') {
        await replyUserError(
            submitted,
            {
                type:
                    ErrorTypes.UNKNOWN,

                message:
                    'You must type "DELETE" exactly to confirm deletion.',
            }
        );

        await refreshDashboard(
            rootInteraction,
            guildConfig,
            guildId,
            client
        );

        return;
    }

    await submitted.deferUpdate();

    /* --------------------------------------------------------------
     * Delete panel
     * -------------------------------------------------------------- */

    if (
        guildConfig.ticketPanelChannelId
    ) {
        try {
            const guild =
                client.guilds.cache.get(
                    guildId
                );

            const panelChannel =
                await guild?.channels
                    .fetch(
                        guildConfig.ticketPanelChannelId
                    )
                    .catch(() => null);

            if (panelChannel) {
                if (
                    guildConfig.ticketPanelMessageId
                ) {
                    const panelMessage =
                        await panelChannel.messages
                            .fetch(
                                guildConfig.ticketPanelMessageId
                            )
                            .catch(() => null);

                    if (panelMessage) {
                        await panelMessage
                            .delete()
                            .catch(() => {});
                    }
                } else {
                    const messages =
                        await panelChannel.messages
                            .fetch({
                                limit: 50,
                            })
                            .catch(() => null);

                    if (messages) {
                        const found =
                            messages.find(
                                (message) =>
                                    message.author.id ===
                                        client.user.id &&
                                    (
                                        message.components?.some(
                                            (row) =>
                                                row.components?.some(
                                                    (component) =>
                                                        component.customId ===
                                                        TICKET_SELECT_ID
                                                )
                                        ) ||
                                        messageHasButtonCustomId(
                                            message,
                                            'create_ticket'
                                        )
                                    )
                            );

                        if (found) {
                            await found
                                .delete()
                                .catch(() => {});
                        }
                    }
                }
            }
        } catch (error) {
            logger.warn(
                'Could not delete ticket panel:',
                error.message
            );
        }
    }


    /* --------------------------------------------------------------
     * Delete ticket records
     * -------------------------------------------------------------- */

    try {
        const {
            pgConfig
        } = await import(
            '../../../config/database/postgres.js'
        );

        if (
            client.db?.db?.pool &&
            typeof client.db.db.isAvailable ===
                'function' &&
            client.db.db.isAvailable()
        ) {
            await client.db.db.pool.query(
                `DELETE FROM ${pgConfig.tables.tickets} WHERE guild_id = $1`,
                [guildId]
            );
        }
    } catch (error) {
        logger.warn(
            'Could not clear ticket records from database:',
            error.message
        );
    }


    /* --------------------------------------------------------------
     * Remove configuration
     * -------------------------------------------------------------- */

    const keysToDelete = [
        'ticketPanelChannelId',
        'ticketPanelMessageId',
        'ticketStaffRoleId',
        'ticketCategoryId',
        'ticketClosedCategoryId',
        'ticketPanelMessage',
        'ticketSelectMenuId',
        'maxTicketsPerUser',
        'dmOnClose',
    ];

    for (
        const key of keysToDelete
    ) {
        delete guildConfig[key];
    }

    await setGuildConfig(
        client,
        guildId,
        guildConfig
    );


    /* --------------------------------------------------------------
     * Final response
     * -------------------------------------------------------------- */

    await submitted.followUp({
        embeds: [
            successEmbed(
                '✅ Ticket System Deleted',
                'All ticket system configuration has been cleared. Run `/ticket setup` to configure it again.'
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });

    await InteractionHelper.safeEditReply(
        rootInteraction,
        {
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        'Ticket System Deleted'
                    )
                    .setDescription(
                        'The ticket system configuration has been cleared.'
                    )
                    .setColor(
                        getColor('error')
                    )
                    .setTimestamp(),
            ],

            components: [],
        }
    ).catch(() => {});
}
```
