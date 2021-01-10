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
use Discord\Parts\WebSockets\MessageReaction;
use Discord\WebSockets\Event;
use FilesystemIterator;
use phpDocumentor\Reflection\DocBlock\Tags\Param;
use phpDocumentor\Reflection\DocBlock\Tags\Return_;
use phpDocumentor\Reflection\DocBlock\Tags\Throws;
use phpDocumentor\Reflection\Element;
use phpDocumentor\Reflection\File\LocalFile;
use phpDocumentor\Reflection\Php\Class_;
use phpDocumentor\Reflection\Php\Method;
use phpDocumentor\Reflection\Php\ProjectFactory;
use phpDocumentor\Reflection\Php\Visibility;
use RecursiveDirectoryIterator;

use function Discord\contains;

class Reflect extends Command
{
    const DISCORD_PHP_DIR = 'vendor/team-reflex/discord-php/src';
    const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

    /**
     * DiscordPHP project.
     *
     * @var \phpDocumentor\Reflection\Php\Project
     */
    private $project;

    protected function init(): void
    {
        $reflector = ProjectFactory::createInstance();
        $files = array_map(function ($file) {
            return new LocalFile($file);
        }, $this->getFiles(self::DISCORD_PHP_DIR));
        $this->project = $reflector->create('DiscordPHP', $files);
    }
    
    /**
     * Gets a list of files in a directory, recursively.
     *
     * @param  string $dir
     * @return array
     */
    private function getFiles(string $dir): array
    {
        $iterator = new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS);
        $results = [];

        foreach ($iterator as $file) {
            if ($file->isDir()) {
                $results = array_merge($results, $this->getFiles($file->getPathname()));
            } else {
                $results[] = $file->getPathname();
            }
        }

        return $results;
    }

    /**
     * Searches through the project looking for the method or class.
     *
     * @param  string    $query
     * @return Element[]
     */
    private function search(?string $query): array
    {
        $results = [];
        
        if (is_null($query)) {
            return $results;
        }

        $searchForMethodsAndProps = strpos($query, '::') !== false;

        foreach ($this->project->getFiles() as $file) {
            foreach ($file->getClasses() as $class) {
                if ($searchForMethodsAndProps) {
                    foreach ($class->getMethods() as $method) {
                        if (contains((string) $method->getFqsen(), [$query])) {
                            $results[] = $method;
                        }
                    }
                }

                if (contains((string) $class->getFqsen(), [$query])) {
                    $results[] = $class;
                }
            }
        }

        return $results;
    }

    /**
     * Generates an embed for a given element.
     *
     * @param phpDocumentor\Reflection\Php\Class_|phpDocumentor\Reflection\Php\Method $element
     * @param string                                                                  $type
     *
     * @return Embed
     */
    private function generateEmbedForElement($element, string $type)
    {
        if ($element instanceof Class_) {
            if ($type == 'properties') {
                return $this->generatePropertyEmbedForClass($element);
            }

            return $this->generateMethodEmbedForClass($element);
        } elseif ($element instanceof Method) {
            return $this->generateEmbedForMethod($element);
        }
    }
    
    /**
     * Generates an embed for class methods.
     *
     * @param  Class_ $class
     * @return Embed
     */
    private function generateMethodEmbedForClass(Class_ $class): Embed
    {
        $embed = new Embed($this->discord);

        $embed
            ->setTitle(sprintf('`%s`', (string) $class->getFqsen()))
            ->setDescription($class->getDocBlock() ? $class->getDocBlock()->getSummary() : 'No description available');

        foreach ($class->getMethods() as $method) {
            // skip private and magic methods
            if ($method->getVisibility() != Visibility::PUBLIC_) {
                continue;
            }
            if (strpos($method->getFqsen()->getName(), '__') !== false) {
                continue;
            }

            if ($embed->fields->count() >= 25) {
                $embed->setFooter(count($class->getMethods()).' method(s) unable to be shown.');
                break;
            }

            $methodFootprint = sprintf('`%s(', $method->getFqsen()->getName());
            foreach ($method->getArguments() as $argument) {
                $methodFootprint .= sprintf('%s $%s, ', (string) $argument->getType(), $argument->getName());
            }
            $methodFootprint = sprintf('%s): %s`', rtrim($methodFootprint, ', '), (string) $method->getReturnType());

            $embed->addFieldValues(
                $methodFootprint,
                $method->getDocBlock()->getSummary()
            );
        }

        return $embed;
    }

    /**
     * Generates an embed for class properties.
     *
     * @param  Class_ $class
     * @return Embed
     */
    private function generatePropertyEmbedForClass(Class_ $class): Embed
    {
        $embed = new Embed($this->discord);

        $embed
            ->setTitle(sprintf('`%s`', (string) $class->getFqsen()))
            ->setDescription($class->getDocBlock() ? $class->getDocBlock()->getSummary() : 'No description available');

        if (! $class->getDocBlock()) {
            return $embed;
        }

        $tags = array_filter($class->getDocBlock()->getTags(), function ($tag) {
            return $tag->getName() == 'property';
        });

        foreach ($tags as $tag) {
            if ($embed->fields->count() >= 25) {
                $embed->setFooter(sprintf('%s %s unable to be shown.', count($tags), count($tags) > 1 ? 'properties' : 'property'));
                break;
            }

            $parts = explode(' ', (string) $tag);
            $type = array_shift($parts);
            $varname = array_shift($parts);
            $description = implode(' ', $parts);

            $embed->addFieldValues(
                sprintf('`%s %s`', $type, $varname),
                empty($description) ? 'No description available' : $description
            );
        }

        return $embed;
    }

    /**
     * Generates an embed for a method.
     *
     * @param  Method $method
     * @return Embed
     */
    private function generateEmbedForMethod(Method $method): Embed
    {
        $embed = new Embed($this->discord);

        $embed
            ->setTitle((string) $method->getFqsen())
            ->setDescription($method->getDocBlock() ? $method->getDocBlock()->getSummary() : 'No description available');

        if (! $method->getDocBlock()) {
            return $embed;
        }

        foreach ($method->getDocBlock()->getTags() as $tag) {
            if ($tag instanceof Param) {
                $embed->addFieldValues(
                    sprintf('`%s $%s`', $tag->getType(), $tag->getVariableName()),
                    empty((string) $tag->getDescription()) ? 'No description available' : (string) $tag->getDescription()
                );
            } elseif ($tag instanceof Return_) {
                $embed->addFieldValues(
                    sprintf('Returns `%s`', $tag->getType()),
                    empty((string) $tag->getDescription()) ? 'No description available' : (string) $tag->getDescription()
                );
            } elseif ($tag instanceof Throws) {
                $embed->addFieldValues(
                    sprintf('Throws `%s`', $tag->getType()),
                    empty((string) $tag->getDescription()) ? 'No description available' : (string) $tag->getDescription()
                );
            }
        }

        return $embed;
    }

    public function handle(Message $message, array $args): void
    {
        $type = array_shift($args);

        $usage = function () use ($message) {
            $content = <<<EOD
Usage:
```
@{$this->discord->username} reflect <methods|properties> <class_name>
@{$this->discord->username} reflect <method_name>
```
Examples:
```
@{$this->discord->username} reflect methods Discord\Discord
@{$this->discord->username} reflect properties Discord\Discord
@{$this->discord->username} reflect Channel::sendMessage
```
EOD;
            $message->reply($content);
        };

        if (is_null($type)) {
            $usage();

            return;
        }

        switch ($type) {
            case 'methods':
            case 'properties':
                break;
            default:
                array_unshift($args, $type);
                $type = 'properties';
                break;
        }

        $results = $this->search(array_shift($args));

        switch (count($results)) {
            case 0:
                $message->reply('No results found.');

                return;
            case 1:
                $embed = $this->generateEmbedForElement($results[0], $type);
                $message->channel->sendEmbed($embed)->done();

                return;
        }

        if (count($results) > 9) {
            $message->reply('Too many results, please narrow your search.');

            return;
        }

        $content = "Please choose an option with reactions:\r\n";

        for ($i = 0; $i < count($results); $i++) {
            $content .= sprintf("%s. %s\r\n", $i + 1, $results[$i]->getFqsen());
        }

        $message->reply($content)->done(function (Message $message) use ($results, $type) {
            for ($i = 0; $i < count($results); $i++) {
                $message->react(self::NUMBER_EMOJIS[$i]);
            }

            $handler = function (MessageReaction $reaction) use (&$handler, $message, $results, $type) {
                if ($reaction->message_id != $message->id) {
                    return;
                }
                if ($reaction->user_id == $this->discord->id) {
                    return;
                }

                for ($i = 0; $i < count($results); $i++) {
                    if (self::NUMBER_EMOJIS[$i] == $reaction->emoji->name) {
                        $embed = $this->generateEmbedForElement($results[$i], $type);
                        $message->channel->sendEmbed($embed)->done();
                        $this->discord->removeListener(Event::MESSAGE_REACTION_ADD, $handler);
                    }
                }
            };

            $this->discord->on(Event::MESSAGE_REACTION_ADD, $handler);
        });
    }

    public function getHelp(): string
    {
        return 'Uses reflection to return the documentation of a given class, method or property.';
    }
}
