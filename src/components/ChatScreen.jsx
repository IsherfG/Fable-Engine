// ChatScreenWithLevel.js
import React, { useState, useEffect } from "react";
import "./ChatScreen.css";
import { GoogleGenerativeAI } from "@google/generative-ai";
import defaultAIProfile from '../assets/defaultAIProfile.png';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const ChatScreenWithLevel = ({ character }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [gameStarted, setGameStarted] = useState(false);
    const [location, setLocation] = useState({
        name: "Oakhaven",
        description: "a small town known for its old ruins",
    });
    const [showStats, setShowStats] = useState(true);
    const [showMap, setShowMap] = useState(false);

    // Inventory state, using an object to store both slots and items
    const [inventory, setInventory] = useState({
        armor: {
            name: "Basic Armor",
            description: "A simple set of leather armor"
        },
        helmet: null,
        pants: null,
        shoe: null,
        weapon1: {
            name: "Rusty Sword",
            description: "A weathered blade that is reliable but not powerful",
        },
        weapon2: null,
        item1: {
            name: "Small Health Potion",
            description: "A small vial containing healing liquid",
        },
        item2: {
            name: "Small Health Potion",
            description: "A small vial containing healing liquid",
        },
        item3: null,
        item4: null,
    });



    // Game Data (Hardcoded for Now)
    const gameData = {
        story: `The ancient evil of Malkor has awakened, spreading corruption across the land. The people of Oakhaven and beyond are in peril. The player characters are tasked with gathering allies, uncovering ancient artifacts, and ultimately confronting Malkor to restore balance to the world.`,
        lore: `Long ago, the world was protected by the 'Crystal of Harmony'. This crystal was shattered, its fragments scattered throughout the land. Malkor, the embodiment of chaos, seeks to gather these fragments to fuel his dark power.`,
        goal: `Collect the fragments of the Crystal of Harmony and defeat Malkor to save the land.`,
        playerCharacters: [
            {
                name: "Adventurer",
                description: "A novice adventurer seeking a new life in Oakhaven.",
            },
        ],
        locations: {
            Oakhaven: {
                name: "Oakhaven",
                description: "a small town known for its old ruins",
                connections: ["Dungeon", "ForestPath"],
                npcs: ["Old Man Hemlock", "Town Guard"],
                enemies: [],
            },
            Dungeon: {
                name: "Dungeon",
                description: "a dark and mysterious underground complex",
                connections: ["Oakhaven", "Catacombs"],
                npcs: [],
                enemies: ["skeleton"],
            },
            ForestPath: {
                name: "ForestPath",
                description: "a winding trail through the forest",
                connections: ["Oakhaven", "Ruins"],
                npcs: [],
                enemies: ["goblin"],
            },
            Catacombs: {
                name: "Catacombs",
                description: "a hidden set of underground tunnels",
                connections: ["Dungeon"],
                npcs: [],
                enemies: [],
            },
            Ruins: {
                name: "Ruins",
                description: "An ancient area with broken walls and artifacts",
                connections: ["ForestPath"],
                npcs: [],
                enemies: [],
            },
        },
        npcs: {
            "Old Man Hemlock": {
                description: "An old man with a kind face, sells items.",
                location: "Oakhaven",
                greeting: "Well hello there, adventurer, what brings you to our town?",
            },
            "Town Guard": {
                description: "A stern and watchful town guard",
                location: "Oakhaven",
                greeting: "Halt! State your purpose in our town!",
            },
        },
        enemies: {
            goblin: {
                name: "Goblin",
                description: "A small green creature that uses dirty fighting tactics.",
            },
            skeleton: {
                name: "Skeleton",
                description: "A risen warrior from a bygone era, now serving as an undead minion.",
            },
        },
        bosses: {
            malkor: {
                name: "Malkor",
                description: "The embodiment of chaos and evil, seeking to control the world",
            },
        },
        items: {
            "Basic Armor": {
                name: "Basic Armor",
                description: "A simple set of leather armor"
            },
            rustySword: {
                name: "Rusty Sword",
                description: "A weathered blade that is reliable but not powerful",
            },
            smallHealthPotion: {
                name: "Small Health Potion",
                description: "A small vial containing healing liquid",
            },
            oldBook: {
                name: "Old Book",
                description: "A dusty old book with ancient text."
            }
        },
    };

    const initialSystemInstructions = `You are a fantasy dungeon master, experienced in running tabletop role-playing games.
    Your role is to first set the stage for the player, then guide the player through an adventure.
    Be creative and descriptive. Be whimsical, but also consistent with the game's established lore.
    Keep the game moving and challenging, while also being fair. Focus on narrative, character development, and player interaction.
    Avoid describing yourself or your role in the game, and speak as if you are the game itself.
    Avoid describing what the player "can" do, instead encourage their imagination.
    Do not use any markdown or any other formatting characters such as ** or *. Use plain text in your responses.

   The game's story is: ${gameData.story}
   The lore is: ${gameData.lore}
   The game's goal is: ${gameData.goal}
    `;

    const gameStartInstructions = `
    You begin by setting the scene and introducing the player to their character.
    Do not begin until the player has introduced their character.
    Then, introduce the game's overarching story or objective. This should be the main focus for the game's start.
    The player starts in ${location.name}, ${location.description}.
    The player's character is ${gameData.playerCharacters[0].name}, ${gameData.playerCharacters[0].description}
     Do not use any markdown or any other formatting characters such as ** or *. Use plain text in your responses.
    Do not start the game until the player introduces themself.
    `;

    const systemInstructions = `
    You are a fantasy dungeon master, experienced in running tabletop role-playing games.
    Be creative and descriptive. Be whimsical, but also consistent with the game's established lore.
    Keep the game moving and challenging, while also being fair. Focus on narrative, character development, and player interaction.
    Do not use any markdown or any other formatting characters such as ** or *. Use plain text in your responses.

    The game's story is: ${gameData.story}
    The lore is: ${gameData.lore}
    The game's goal is: ${gameData.goal}
    The player is currently in ${location.name}, ${location.description}. Available locations are: ${Object.keys(
        gameData.locations
    ).join(", ")}
    Available npcs: ${gameData.locations[location.name]?.npcs?.join(", ") || "none"}. Available items: ${Object.keys(gameData.items).join(", ")}
    `;

    useEffect(() => {
        const initialMessage = {
            text: "Welcome to the world of adventure! Introduce yourself to begin.",
            sender: "ai",
            timestamp: new Date(),
        };
        setMessages([initialMessage]);
    }, []);

    useEffect(() => {
        const handleResize = () => {
           setShowStats(window.innerWidth > 768);
        };
        handleResize(); // Set initial state
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);


    const removeFormattingCharacters = (text) => {
        return text.replace(/\*\*|\*/g, '');
    }

    const sendMessage = async () => {
        if (!input.trim()) return;

        const userMessage = { text: input, sender: "user", timestamp: new Date() };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsTyping(true);

        let prompt = `${initialSystemInstructions}\n`;

        if (!gameStarted) {
            prompt += `${gameStartInstructions}\n`;
            if (input.toLowerCase().includes("name is")) {
                setGameStarted(true);
                prompt += `Player Input: ${input}\n`;
                prompt += `Now that you've introduced yourself, you can introduce the game story, location and your character.`;
            } else {
                prompt += `Player Input: ${input}\n`;
                prompt += `Do not start until the player introduces their character by saying "My name is [name]."`;
            }
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                let text = response.text();
                text = removeFormattingCharacters(text);
                const aiResponse = { text: text, sender: "ai", timestamp: new Date() };
                setMessages((prev) => [...prev, aiResponse]);
            } catch (error) {
                console.error("Gemini API error:", error);
                const errorMessage = {
                    text: "Sorry, I am having trouble with that right now.",
                    sender: "ai",
                    timestamp: new Date(),
                };
                setMessages((prev) => [...prev, errorMessage]);
            } finally {
                setIsTyping(false);
            }
            return;
        }

        let processedResponse = null;

        // Check for commands
        if (input.toLowerCase().startsWith("go ")) {
            processedResponse = handleGoCommand(input);

        } else if (input.toLowerCase().startsWith("talk ")) {
            processedResponse = await handleTalkCommand(input);
        }
        else if (input.toLowerCase().startsWith("attack ")) {
            processedResponse = handleAttackCommand(input);
        } else if (input.toLowerCase().startsWith("use ")) {
            processedResponse = handleUseCommand(input);
        } else {
            // Handle as regular message
            prompt += `\n${systemInstructions}\nPlayer Input: ${input}\n`;
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                let text = response.text();
                text = removeFormattingCharacters(text);
                processedResponse = { text: text, sender: "ai", timestamp: new Date(), type: "narrator" };
            } catch (error) {
                console.error("Gemini API error:", error);
                processedResponse = {
                    text: "Sorry, I am having trouble with that right now.",
                    sender: "ai",
                    timestamp: new Date(),
                };
            }
        }

        if (processedResponse) {
            setMessages((prev) => [...prev, processedResponse]);
        }
        setIsTyping(false);
    };


    const handleGoCommand = (input) => {
        const destination = input.substring(3).trim();
        if (gameData.locations[location.name].connections.includes(destination)) {
            const newLocation = gameData.locations[destination];
            setLocation(newLocation);
            return {
                text: `As you travel to ${newLocation.name}, you find yourself in ${newLocation.description}.`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            };
        } else {
            return {
                text: `You cannot go to ${destination} from your current location.`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            };
        }
    };

    const handleAttackCommand = (input) => {
        const target = input.substring(7).trim();

        if (gameData.locations[location.name].enemies.includes(target)) {
            return {
                text: `You attack the ${target}. (attack logic will be added later).`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            }

        } else {
            return {
                text: `There is no ${target} in this location to attack.`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            }
        }
    }

    const handleUseCommand = (input) => {
        const item = input.substring(4).trim();

        // Check if the item is in the inventory
        let found = false;

        for (let key in inventory) {
            if (inventory[key]?.name === item) {
                found = true;
                // Perform action based on the item
                // add logic here.
                return {
                    text: `You use ${item}. The effect will be added later.`,
                    sender: "ai",
                    timestamp: new Date(),
                    type: "narrator"
                }
            }
        }

        if (!found) {
            return {
                text: `You don't have ${item}.`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            }
        }

    }
    const handleTalkCommand = async (input) => {
        const target = input.substring(5).trim();
        if (gameData.npcs[target] && gameData.npcs[target].location === location.name) {
            const npc = gameData.npcs[target];
            try {
                const prompt = `You are a fantasy dungeon master, experienced in running tabletop role-playing games.
                The player is in location ${location.name}.
                The player wants to talk to ${npc.description} located in ${location.name}.
                The npc should respond as the npc would in this setting. Avoid describing the character you are playing,
                and use plain text without any asterisks or other markdown formatting. The npc's greeting is ${npc.greeting}. The player's input is: ${input} `;
                const result = await model.generateContent(prompt);
                const response = await result.response;
                let text = response.text();
                text = removeFormattingCharacters(text);
                return { text: text, sender: "ai", timestamp: new Date(), type: "npc", npcName: target };
            } catch (error) {
                console.error("Gemini API error:", error);
                return {
                    text: "Sorry, I am having trouble with that right now.",
                    sender: "ai",
                    timestamp: new Date(),
                };
            }

        } else {
            return {
                text: `There is no one named ${target} to talk to here.`,
                sender: "ai",
                timestamp: new Date(),
                type: "narrator"
            };
        }
    };

    return (
        <div className={`chat-level-container ${showStats ? "" : "full-screen-chat"}`}>
            <div className="chat-container">
                <div className="chat-header">
                    <h1>FABLE ENGINE v0.1</h1>
                    {/* Show "Show Stats" button in chat-header on mobile when stats are hidden */}
                    {window.innerWidth <= 768 && !showStats && (
                        <button
                            className="toggle-stats-button"
                            onClick={() => setShowStats(true)}
                        >
                            Show Stats
                        </button>
                    )}
                    {/* Hide the button in chat-header in desktop */}
                    {window.innerWidth > 768 && (
                        <button
                            className="toggle-stats-button"
                            onClick={() => setShowStats((prev) => !prev)}
                        >
                            {showStats ? "Hide Stats" : "Show Stats"}
                        </button>
                    )}
                </div>
                <div className="chat-messages">
                    {messages.map((msg, index) => (
                        <div key={index} className={`message-container ${msg.sender}`}>
                            {msg.sender === 'ai' && (
                                <img src={defaultAIProfile} alt="AI Profile" className="profile-image" />
                            )}
                            <div className={`message ${msg.sender} ${msg.type || ''}`}>
                                {msg.type === "npc" && <span className="npc-name">{msg.npcName}: </span>}
                                <p>{msg.text}</p>
                                <span className="timestamp">{msg.timestamp.toLocaleTimeString()}</span>
                            </div>
                        </div>
                    ))}
                    {isTyping && (
                        <div className="message-container ai">
                            <img src={defaultAIProfile} alt="AI Profile" className="profile-image" />
                            <div className="message ai">
                                <p>...</p>
                            </div>
                        </div>
                    )}
                </div>
                <div className="chat-input">
                    <input
                        type="text"
                        placeholder="Type your command..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                    />
                    <button onClick={sendMessage} disabled={isTyping}>
                        {isTyping ? "Loading..." : "Send"}
                    </button>
                </div>
            </div>
            {showStats && (
                <div className="level-info">
                    <div className="level-info-header">
                        <h2>Level 1</h2>
                        {/* Show "Hide Stats" button in level-info header on mobile only if stats are shown */}
                        {window.innerWidth <= 768 && showStats && (
                            <button
                                className="toggle-stats-button"
                                onClick={() => setShowStats(false)}
                            >
                                Hide Stats
                            </button>
                        )}
                    </div>
                    <div className="stat">
                        <label>Health</label>
                        <div className="bar">
                            <div className="fill health" style={{ width: "100%" }}></div>
                        </div>
                    </div>
                    <div className="stat">
                        <label>Mana</label>
                        <div className="bar">
                            <div className="fill mana" style={{ width: "100%" }}></div>
                        </div>
                    </div>
                    <div className="stat">
                        <label>Experience</label>
                        <div className="bar">
                            <div className="fill experience" style={{ width: "0%" }}></div>
                        </div>
                    </div>

                    {character?.profileImage && (
                        <div className="character-profile-image">
                            <img src={character.profileImage} alt="Player Profile" />
                        </div>
                    )}

                    {character && (
                        <div className="character-stats">
                            <h3>Character Stats</h3>
                            {Object.entries(character.stats).map(([stat, value]) => (
                                <div key={stat} className="stat-item">
                                    <span>
                                        {stat}: {value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="map-container">
                        <div className="map-header">
                            <button onClick={() => setShowMap(!showMap)} className="toggle-map-button">
                                {showMap ? "Hide Map" : "Show Map"}
                            </button>
                        </div>
                        {showMap && (
                            <div className="map-content">
                                <img src="/images/map.jpg" alt="Game Map" className="game-map-image" />
                            </div>
                        )}
                    </div>
                    <div className="inventory-container">
                        <h3>Inventory</h3>
                        <div className="inventory-slots">
                            {Object.entries(inventory).map(([slot, item]) => (
                                <div key={slot} className="inventory-slot">
                                    <span>{slot} : {item?.name || "Empty"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatScreenWithLevel;