import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
} from 'discord.js';

import { getColor } from '../../config/bot.js';
import {
    createEmbed,
    successEmbed,
} from '../../utils/embeds.js';

import {
    getGuildConfig,
    setGuildConfig,
} from '../../services/config/guildConfig.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

import {
    handleInteractionError,
    replyUserError,
    ErrorTypes,
} from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription("Manages the server's ticket system.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)

        // ============================================================
        // /ticket setup
        // ============================================================
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription(
                    'Sets up the ticket creation panel in a specified channel.'
                )

                .addChannelOption((option) =>
                    option
                        .setName('panel_channel')
                        .setDescription(
                            'The channel where the ticket panel will be sent.'
                        )
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )

                .addStringOption((option) =>
                    option
                        .setName('panel_message')
                        .setDescription(
                            'The main message/description for the ticket panel.'
                        )
                        .setRequired(true)
                )

                .addChannelOption((option) =>
                    option
                        .setName('category')
                        .setDescription(
                            'The category where new tickets will be created (optional).'
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false)
                )

                .addChannelOption((option) =>
                    option
                        .setName('closed_category')
                        .setDescription(
                            'The category where closed tickets will be moved (optional).'
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false)
                )

                .addRoleOption((option) =>
                    option
                        .setName('staff_role')
                        .setDescription(
                            'The role that can access tickets (optional).'
                        )
                        .setRequired(false)
                )

                .addIntegerOption((option) =>
                    option
                        .setName('max_tickets_per_user')
                        .setDescription(
                            'Maximum number of tickets a user can create (default: 3).'
                        )
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false)
                )

                .addBooleanOption((option) =>
                    option
                        .setName('dm_on_close')
                        .setDescription(
                            'Send DM to user when their ticket is closed (default: true).'
                        )
                        .setRequired(false)
                )
        )

        // ============================================================
        // /ticket dashboard
        // ============================================================
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription(
                    'Open the interactive ticket system dashboard.'
                )
        ),

    category: 'ticket',

    async execute(interaction, config, client) {
        // ============================================================
        // Defer response
        // ============================================================
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });

        if (!deferred) {
            return;
        }

        // ============================================================
        // Permission check
        // ============================================================
        if (
            !interaction.member.permissions.has(
                PermissionFlagsBits.ManageChannels
            )
        ) {
            logger.warn('Ticket command permission denied', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ticket',
            });

            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message:
                    'You need the `Manage Channels` permission for this action.',
            });
        }

        const subcommand = interaction.options.getSubcommand();

        // ============================================================
        // Dashboard
        // ============================================================
        if (subcommand === 'dashboard') {
            return ticketConfig.execute(
                interaction,
                config,
                client
            );
        }

        // ============================================================
        // Setup
        // ============================================================
        if (subcommand === 'setup') {
            try {
                // ----------------------------------------------------
                // Check existing configuration
                // ----------------------------------------------------
                const existingConfig =
                    await getGuildConfig(
                        client,
                        interaction.guildId
                    );

                if (existingConfig?.ticketPanelChannelId) {
                    return await replyUserError(interaction, {
                        type: ErrorTypes.UNKNOWN,
                        message:
                            `This server already has a ticket system set up ` +
                            `(panel in <#${existingConfig.ticketPanelChannelId}>).\n\n` +
                            `Only one ticket system is supported per server. ` +
                            `Use \`/ticket dashboard\` to edit or update the existing setup, ` +
                            `or select **Delete System** from the dashboard to remove it and start fresh.`,
                    });
                }

                // ----------------------------------------------------
                // Get command options
                // ----------------------------------------------------
                const panelChannel =
                    interaction.options.getChannel(
                        'panel_channel'
                    );

                const categoryChannel =
                    interaction.options.getChannel(
                        'category'
                    );

                const closedCategoryChannel =
                    interaction.options.getChannel(
                        'closed_category'
                    );

                const staffRole =
                    interaction.options.getRole(
                        'staff_role'
                    );

                const panelMessage =
                    interaction.options.getString(
                        'panel_message'
                    ) ||
                    'Select the type of ticket you would like to create from the dropdown below.';

                const maxTicketsPerUser =
                    interaction.options.getInteger(
                        'max_tickets_per_user'
                    ) || 3;

                const dmOnClose =
                    interaction.options.getBoolean(
                        'dm_on_close'
                    ) !== false;

                // ----------------------------------------------------
                // Create panel embed
                // ----------------------------------------------------
                const setupEmbed = createEmbed({
                    title: '🎫 Support Tickets',
                    description: panelMessage,
                    color: getColor('info'),
                });

                // ----------------------------------------------------
                // Create ticket type dropdown
                // ----------------------------------------------------
                const ticketSelect = new StringSelectMenuBuilder()
                    .setCustomId('ticket_type_select')
                    .setPlaceholder('Select a ticket type...')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('General Support')
                            .setDescription(
                                'Get help with a general question or issue.'
                            )
                            .setValue('general_support')
                            .setEmoji('🛠️'),

                        new StringSelectMenuOptionBuilder()
                            .setLabel('Billing')
                            .setDescription(
                                'Questions about payments, purchases, or billing.'
                            )
                            .setValue('billing')
                            .setEmoji('💰'),

                        new StringSelectMenuOptionBuilder()
                            .setLabel('Report a User')
                            .setDescription(
                                'Report a user or behavior to the staff team.'
                            )
                            .setValue('report_user')
                            .setEmoji('🚨'),

                        new StringSelectMenuOptionBuilder()
                            .setLabel('Partnership')
                            .setDescription(
                                'Contact the staff team about a partnership.'
                            )
                            .setValue('partnership')
                            .setEmoji('🤝'),

                        new StringSelectMenuOptionBuilder()
                            .setLabel('Other')
                            .setDescription(
                                'Create a ticket for another reason.'
                            )
                            .setValue('other')
                            .setEmoji('📩')
                    );

                const ticketSelectRow =
                    new ActionRowBuilder().addComponents(
                        ticketSelect
                    );

                // ----------------------------------------------------
                // Send panel
                // ----------------------------------------------------
                const sentPanel =
                    await panelChannel.send({
                        embeds: [setupEmbed],
                        components: [ticketSelectRow],
                    });

                // ----------------------------------------------------
                // Save configuration
                // ----------------------------------------------------
                if (client.db && interaction.guildId) {
                    /*
                     * Use an empty object if no previous configuration
                     * exists. This prevents trying to assign properties
                     * to null/undefined.
                     */
                    const currentConfig = {
                        ...(existingConfig || {}),
                    };

                    currentConfig.ticketCategoryId =
                        categoryChannel
                            ? categoryChannel.id
                            : null;

                    currentConfig.ticketClosedCategoryId =
                        closedCategoryChannel
                            ? closedCategoryChannel.id
                            : null;

                    currentConfig.ticketStaffRoleId =
                        staffRole
                            ? staffRole.id
                            : null;

                    currentConfig.ticketPanelChannelId =
                        panelChannel.id;

                    currentConfig.ticketPanelMessageId =
                        sentPanel?.id || null;

                    currentConfig.ticketPanelMessage =
                        panelMessage;

                    currentConfig.maxTicketsPerUser =
                        maxTicketsPerUser;

                    currentConfig.dmOnClose =
                        dmOnClose;

                    /*
                     * Stores the custom ID used by the dropdown.
                     * This makes it easy for the interaction handler
                     * to identify this menu.
                     */
                    currentConfig.ticketSelectMenuId =
                        'ticket_type_select';

                    await setGuildConfig(
                        client,
                        interaction.guildId,
                        currentConfig
                    );

                    logger.info(
                        'Ticket configuration saved',
                        {
                            guildId:
                                interaction.guildId,
                            categoryId:
                                categoryChannel?.id,
                            closedCategoryId:
                                closedCategoryChannel?.id,
                            staffRoleId:
                                staffRole?.id,
                            maxTickets:
                                maxTicketsPerUser,
                            dmOnClose,
                            ticketSelectMenuId:
                                'ticket_type_select',
                        }
                    );
                } else {
                    logger.error(
                        'Ticket setup: database unavailable, panel sent but configuration was NOT saved',
                        {
                            guildId:
                                interaction.guildId,
                        }
                    );
                }

                // ====================================================
                // Success message
                // ====================================================
                let successMessage =
                    `The ticket panel has been sent to ${panelChannel}.`;

                if (categoryChannel) {
                    successMessage +=
                        `\n\nNew tickets will be created in the **${categoryChannel.name}** category.`;
                } else {
                    successMessage +=
                        '\n\nNew tickets will be created in a new **Tickets** category.';
                }

                if (closedCategoryChannel) {
                    successMessage +=
                        `\nClosed tickets will be moved to the **${closedCategoryChannel.name}** category.`;
                }

                if (staffRole) {
                    successMessage +=
                        `\n**${staffRole.name}** will have access to tickets.`;
                }

                successMessage +=
                    `\n\n**Max Tickets Per User:** ${maxTicketsPerUser}`;

                successMessage +=
                    `\n**DM on Close:** ${
                        dmOnClose
                            ? 'Enabled'
                            : 'Disabled'
                    }`;

                successMessage +=
                    '\n\n**Ticket Types:** General Support, Billing, Report a User, Partnership, Other';

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            successEmbed(
                                'Ticket Panel Set Up',
                                successMessage
                            ),
                        ],
                    }
                );

                // ====================================================
                // Logging
                // ====================================================
                logger.info(
                    'Ticket panel setup completed',
                    {
                        userId:
                            interaction.user.id,
                        userTag:
                            interaction.user.tag,
                        guildId:
                            interaction.guildId,
                        panelChannelId:
                            panelChannel.id,
                        panelMessageId:
                            sentPanel?.id,
                        categoryId:
                            categoryChannel?.id,
                        closedCategoryId:
                            closedCategoryChannel?.id,
                        staffRoleId:
                            staffRole?.id,
                        maxTickets:
                            maxTicketsPerUser,
                        dmOnClose,
                        ticketSelectMenuId:
                            'ticket_type_select',
                        commandName:
                            'ticket_setup',
                    }
                );

                // ====================================================
                // Configuration log embed
                // ====================================================
                const logEmbed = createEmbed({
                    title:
                        'Ticket System Setup (Configuration Log)',

                    description:
                        `The ticket panel was set up in ${panelChannel} ` +
                        `by ${interaction.user}.`,

                    color: getColor('warning'),
                }).addFields(
                    {
                        name: 'Panel Channel',
                        value:
                            panelChannel.toString(),
                        inline: true,
                    },

                    {
                        name: 'Ticket Category',
                        value:
                            categoryChannel
                                ? categoryChannel.toString()
                                : 'None specified.',
                        inline: true,
                    },

                    {
                        name: 'Closed Category',
                        value:
                            closedCategoryChannel
                                ? closedCategoryChannel.toString()
                                : 'None specified.',
                        inline: true,
                    },

                    {
                        name: 'Staff Role',
                        value:
                            staffRole
                                ? staffRole.toString()
                                : 'None specified.',
                        inline: true,
                    },

                    {
                        name: 'Max Tickets Per User',
                        value:
                            maxTicketsPerUser.toString(),
                        inline: true,
                    },

                    {
                        name: 'DM on Close',
                        value:
                            dmOnClose
                                ? 'Enabled'
                                : 'Disabled',
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
                    },

                    {
                        name: 'Moderator',
                        value:
                            `${interaction.user.tag} (${interaction.user.id})`,
                        inline: false,
                    }
                );

                /*
                 * If you have a logging channel configured elsewhere,
                 * send `logEmbed` there.
                 *
                 * The original script created this embed but never
                 * actually sent it anywhere, so it is intentionally
                 * left prepared here.
                 */

            } catch (error) {
                // ====================================================
                // Error handling
                // ====================================================
                logger.error(
                    'Ticket setup error',
                    {
                        error:
                            error.message,
                        stack:
                            error.stack,
                        userId:
                            interaction.user.id,
                        guildId:
                            interaction.guildId,
                        commandName:
                            'ticket_setup',
                    }
                );

                if (
                    interaction.deferred ||
                    interaction.replied
                ) {
                    await replyUserError(
                        interaction,
                        {
                            type:
                                ErrorTypes.UNKNOWN,

                            message:
                                "Could not send the ticket panel or save the configuration. Check the bot's permissions, especially **Send Messages**, **Embed Links**, and **View Channel**, as well as the database connection.",
                        }
                    ).catch((err) => {
                        logger.error(
                            'Failed to send error reply',
                            {
                                error:
                                    err.message,
                                guildId:
                                    interaction.guildId,
                            }
                        );
                    });
                } else {
                    await handleInteractionError(
                        interaction,
                        error,
                        {
                            commandName:
                                'ticket_setup',

                            source:
                                'ticket_setup_command',
                        }
                    );
                }
            }
        }
    },
};
