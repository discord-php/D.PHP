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

use Discord\Parts\Channel\Message;
use Discord\Parts\Embed\Embed;

class Events extends Command
{
    /**
     * A list of events and their counts.
     *
     * @var array
     */
    protected $events = [];

    protected function init(): void
    {
        $this->discord->on('raw', function ($event) {
            if ($event->t ?? null != null) {
                if (! array_key_exists($event->t, $this->events)) {
                    $this->events[$event->t] = 1;
                } else {
                    $this->events[$event->t] += 1;
                }
            }
        });
    }

    public function handle(Message $message, array $args): void
    {
        $embed = new Embed($this->discord);
        $embed->setTitle('D.PHP Event Counts')
                ->setDescription('This contains a list of the amount of events we have seen, sorted by event.');

        $total = 0;
        $c = 0;
        foreach ($this->events as $event => $count) {
            // Limit events to 24
            if ($c >= 24) {
                break;
            }

            $embed->addFieldValues("`{$event}`", $count);
            $total += $count;
            $c++;
        }

        $embed->addFieldValues('Total Events', $total);
        $message->channel->sendEmbed($embed);
    }

    public function getHelp(): string
    {
        return 'Returns statistics about events that the bot has seen.';
    }
}
