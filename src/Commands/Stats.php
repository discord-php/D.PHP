<?php

/*
 * This file is a part of the D.PHP project.
 *
 * Copyright (c) 2020-present David Cole <david.cole1340@gmail.com>
 *
 * This source file is subject to the GNU Affero General Public License v3.0 or later
 * that is bundled with this source code in the LICENSE.md file.
 */

namespace DPHP\Commands;

use Carbon\Carbon;
use Discord\Parts\Channel\Message;
use Discord\Parts\Embed\Embed;

class Stats extends Command
{
    /**
     * Start time of bot.
     *
     * @var Carbon
     */
    private $startTime;

    /**
     * Last reconnect time of bot.
     *
     * @var Carbon
     */
    private $lastReconnect;

    protected function init(): void
    {
        $this->startTime = $this->lastReconnect = Carbon::now();

        $this->discord->on('reconnected', function () {
            $this->lastReconnect = Carbon::now();
        });
    }

    /**
     * Returns the number of channels visible to the bot.
     *
     * @return int
     */
    private function getChannelCount(): int
    {
        $channelCount = $this->discord->private_channels->count();

        /* @var \Discord\Parts\Guild\Guild */
        foreach ($this->discord->guilds as $guild) {
            $channelCount += $guild->channels->count();
        }

        return $channelCount;
    }

    /**
     * Returns the current commit of DiscordPHP.
     *
     * @return string
     */
    private function getDiscordPHPVersion(): string
    {
        return str_replace(
            "\n", ' ',
            `cd vendor/team-reflex/discord-php; git rev-parse --abbrev-ref HEAD; git log --oneline -1`
        );
    }

    /**
     * Returns the memory usage of the PHP process in a user-friendly format.
     *
     * @return string
     */
    private function getMemoryUsageFriendly(): string
    {
        $size = memory_get_usage(true);
        $unit = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

        return @round($size / pow(1024, ($i = floor(log($size, 1024)))), 2).' '.$unit[$i];
    }

    public function handle(Message $message, array $args): void
    {
        $embed = new Embed($this->discord);
        $embed
            ->setTitle('DiscordPHP')
            ->setDescription('This bot runs with DiscordPHP. Used for stability testing and library help to users.')
            ->addFieldValues('PHP Version', phpversion())
            ->addFieldValues('DiscordPHP Version', $this->getDiscordPHPVersion())
            ->addFieldValues('Start time', $this->startTime->longRelativeToNowDiffForHumans(3))
            ->addFieldValues('Last reconnected', $this->lastReconnect->longRelativeToNowDiffForHumans(3))
            ->addFieldValues('Guild count', $this->discord->guilds->count())
            ->addFieldValues('Channel count', $this->getChannelCount())
            ->addFieldValues('User count', $this->discord->users->count())
            ->addFieldValues('Memory usage', $this->getMemoryUsageFriendly());

        $message->channel->sendEmbed($embed);
    }

    public function getHelp(): string
    {
        return 'Provides statistics relating to the bots health.';
    }
}
