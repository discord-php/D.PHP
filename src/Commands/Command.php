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

use Discord\Discord;
use Discord\Parts\Channel\Message;

abstract class Command
{
    /**
     * @var Discord
     */
    protected $discord;

    public function __construct(Discord $discord)
    {
        $this->discord = $discord;
        $this->init();
    }

    /**
     * Does any extra set-up for the command.
     */
    protected function init(): void
    {
    }

    /**
     * Handles the command being called.
     *
     * @param Message $message
     * @param array   $args
     */
    abstract public function handle(Message $message, array $args): void;

    /**
     * Returns a string for help.
     *
     * @return string
     */
    abstract public function getHelp(): string;
}
