// src/components/ChatScreenWithLevel.js
import React, { useState, useEffect, useRef } from "react";
import "./ChatScreen.css";
import { GoogleGenerativeAI } from "@google/generative-ai";
import defaultAIProfile from '../assets/defaultAIProfile.png';
import gameData from '../data/gameData';
import gameInstructions from '../data/gameInstructions';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const ChatScreenWithLevel = ({ character }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [gameStarted, setGameStarted] = useState(false);
      const [playerHealth, setPlayerHealth] = useState(100); // Player Health
    const [inCombat, setInCombat] = useState(false); // is player in combat
   const [currentEnemy, setCurrentEnemy] = useState(null); // current enemy in combat
    const [location, setLocation] = useState({
        name: "Oakhaven",
         sublocation: "Town Gate",
        description: "a small town known for its old ruins",
    });
    const [showStats, setShowStats] = useState(true);
    const [showMap, setShowMap] = useState(false);
    const levelInfoRef = useRef(null);
   const speechRef = useRef(null);

    // Inventory state
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

    const initialSystemInstructions = gameInstructions.initialSystemInstructions
        .replace('GAME_STORY', gameData.story)
        .replace('GAME_LORE', gameData.lore)
        .replace('GAME_GOAL', gameData.goal);

    const gameStartInstructions = gameInstructions.gameStartInstructions
        .replace('START_LOCATION_NAME', location.name)
        .replace('START_LOCATION_SUBLOCATION', location.sublocation)
        .replace('START_LOCATION_DESCRIPTION', location.description)
        .replace('PLAYER_CHARACTER_NAME', gameData.playerCharacters[0].name)
        .replace('PLAYER_CHARACTER_DESCRIPTION', gameData.playerCharacters[0].description);

    const systemInstructions = `
    You are a fantasy dungeon master, experienced in running tabletop role-playing games.
    Be creative and descriptive. Be whimsical, but also consistent with the game's established lore.
    Keep the game moving and challenging, while also being fair. Focus on narrative, character development, and player interaction.
    Do not use any markdown or any other formatting characters such as ** or *. Use plain text in your responses.

    The game's story is: ${gameData.story}
    The lore is: ${gameData.lore}
    The game's goal is: ${gameData.goal}
    The player is currently in ${location.name}, ${location.sublocation}, ${location.description}. Available locations are: ${Object.keys(
        gameData.locations
    ).join(", ")}
    Available sublocations for the current area are: ${Object.keys(gameData.locations[location.name].sublocations).join(", ")}
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

 const initializeSpeech = () => {
      if ('speechSynthesis' in window) {
       return window.speechSynthesis
     } else {
        console.error("Text-to-speech is not supported in this browser.");
       return null;
      }
    };

  const speak = (text) => {
         const synth = initializeSpeech();
         if (!synth) return;

           if (speechRef.current && synth.speaking) {
                 synth.cancel();
             }

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.9;
            utterance.pitch = 1;
             speechRef.current = utterance;
           synth.speak(utterance);
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
                  speak(text);
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
        if (inCombat){
            if (input.toLowerCase().startsWith("attack")) {
                processedResponse = await handleCombatTurn(input);
            } else {
                 processedResponse = {
                    text: "You are in combat, you can only attack.",
                    sender: "ai",
                    timestamp: new Date(),
                    type: "narrator"
                 }
            }
        } else if (input.toLowerCase().startsWith("go to ")) {
            processedResponse = handleGoCommand(input);
        } else if (input.toLowerCase().startsWith("where am i")) {
            processedResponse = handleWhereAmICommand();
        }  else if (input.toLowerCase().startsWith("talk ")) {
            processedResponse = await handleTalkCommand(input);
        }
        else if (input.toLowerCase().startsWith("attack ")) {
          processedResponse = await handleAttackCommand(input);
       }else if (input.toLowerCase().startsWith("use ")) {
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
                speak(text);
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
             if (processedResponse.type !== "user") {
                  speak(processedResponse.text);
            }
        }
        setIsTyping(false);
    };

   const handleGoCommand = (input) => {
        const destination = input.substring(6).trim().toLowerCase();
        let newLocation = null;

        if (gameData.locations[location.name].sublocations) {
             const sublocationKeys = Object.keys(gameData.locations[location.name].sublocations).map(key => key.toLowerCase());
            if (sublocationKeys.includes(destination)) {
                const sublocationName = Object.keys(gameData.locations[location.name].sublocations)[sublocationKeys.indexOf(destination)];
              newLocation = { ...location, sublocation: sublocationName, description: gameData.locations[location.name].sublocations[sublocationName].description };
            }
        }

       if (!newLocation) {
           const locationKeys = Object.keys(gameData.locations).map(key => key.toLowerCase());
           if (locationKeys.includes(destination)) {
              if (gameData.locations[location.name].connections.includes(Object.keys(gameData.locations)[locationKeys.indexOf(destination)]))
                  {
                      const locationName = Object.keys(gameData.locations)[locationKeys.indexOf(destination)]
                     newLocation = {name: locationName, sublocation: Object.keys(gameData.locations[locationName].sublocations)[0], description: gameData.locations[locationName].sublocations[Object.keys(gameData.locations[locationName].sublocations)[0]].description};
               }
            }
        }

        if(newLocation){
            setLocation(newLocation);
            return  {
                text: `As you travel to ${newLocation.sublocation}, you find yourself in ${newLocation.description}.`,
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


    const handleWhereAmICommand = () => {
        return {
            text: `You are currently in ${location.name}, ${location.sublocation}, ${location.description}.`,
             sender: "ai",
           timestamp: new Date(),
            type: "narrator"
        };
    };


    const handleAttackCommand = async (input) => {
        const target = input.substring(7).trim();
         const currentLocation = gameData.locations[location.name]
         if (currentLocation && currentLocation.enemies.includes(target)) {
            // Start combat
            setCurrentEnemy(target);
            setInCombat(true);
             return {
                text: `You have engaged in combat with a ${target}!`,
                sender: "ai",
                 timestamp: new Date(),
                type: "narrator"
            };

         } else {
            return {
               text: `There is no ${target} in this location to attack.`,
               sender: "ai",
               timestamp: new Date(),
               type: "narrator"
            }
        }
    };


      const handleCombatTurn = async (input) => {
        if (!currentEnemy) return;

        // Get enemy data
        const enemyData = gameData.enemies[currentEnemy];
           if(!enemyData?.isAlive) {
            setInCombat(false);
             return {
                text: `The ${currentEnemy} is already defeated.`,
                 sender: "ai",
               timestamp: new Date(),
                 type: "narrator"
            }
        }
        //Player attack logic
        const damage = Math.floor(Math.random() * 5) + 1; // Random from 1-5

          let combatText = `You attack the ${currentEnemy} and do ${damage} damage.\n`;
            enemyData.health -= damage;
          if(enemyData.health <= 0){
             enemyData.isAlive = false;
              setInCombat(false);
            return {
                text: combatText + `The ${currentEnemy} has been defeated!`,
                sender: "ai",
                 timestamp: new Date(),
                 type: "narrator"
            };
        }


        //Enemy turn
          combatText += `The ${currentEnemy} attacks you, dealing ${enemyData.damage} damage. \n`;
          setPlayerHealth((prev) => prev - enemyData.damage);

          if (playerHealth - enemyData.damage <= 0) {
               setInCombat(false);
               setPlayerHealth(0);
                return {
                     text: combatText + `You have been defeated, game over!`,
                     sender: "ai",
                     timestamp: new Date(),
                      type: "narrator"
                };
            }
             return {
               text: combatText + `Your current health is ${playerHealth}.`,
               sender: "ai",
                 timestamp: new Date(),
                type: "narrator"
            };
    };


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
               const prompt =  `You are a fantasy dungeon master, experienced in running tabletop role-playing games.
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

   const handleStatsTouchStart = (e) => {
       if (levelInfoRef.current && levelInfoRef.current.contains(e.target)) {
           e.stopPropagation();
      }
    };

    return (
        <div className={`chat-level-container ${showStats ? "" : "full-screen-chat"}`}>
            <div className="chat-container">
                 <div className="chat-header">
                    <h1>FABLE ENGINE v0.1a</h1>
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
                <div className="level-info" ref={levelInfoRef} onTouchStart={handleStatsTouchStart}>
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
                            <div className="fill health" style={{ width: `${playerHealth}%` }}></div>
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