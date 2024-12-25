import React, { useState, useEffect } from "react";
import "./ChatScreen.css";
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;// Replace with your actual API key

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const ChatScreenWithLevel = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [gameStarted, setGameStarted] = useState(false);
     const [location, setLocation] = useState({ name: "Oakhaven", description: "a small town known for its old ruins" });
    
    // Manual game data
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
                description: "A small town known for its old ruins",
                connections: ["Dungeon", "ForestPath"],
            },
            Dungeon: {
                name: "Dungeon",
                description: "A dark and mysterious underground complex",
                connections: ["Oakhaven", "Catacombs"],
            },
            ForestPath: {
                name: "ForestPath",
                description: "A winding trail through the forest",
                connections: ["Oakhaven", "Ruins"],
            },
            Catacombs: {
                name: "Catacombs",
                description: "A hidden set of underground tunnels",
                connections: ["Dungeon"],
            },
            Ruins: {
                name: "Ruins",
                description: "An ancient area with broken walls and artifacts",
                connections: ["ForestPath"],
            },
        },
          enemies: {
                goblin: "A small green creature that uses dirty fighting tactics.",
                skeleton: "A risen warrior from a bygone era, now serving as an undead minion.",
          },
         bosses: {
            malkor: "The embodiment of chaos and evil, seeking to control the world",
         },
          items: {
              rustySword: "A weathered blade that is reliable but not powerful",
               smallHealthPotion: "A small vial containing healing liquid",
           }
    };
   
    const initialSystemInstructions = `You are a fantasy dungeon master, experienced in running tabletop role-playing games.
    Your role is to first set the stage for the player, then guide the player through an adventure.
    Be creative and descriptive. Be whimsical, but also consistent with the game's established lore.
    Keep the game moving and challenging, while also being fair. Focus on narrative, character development, and player interaction.
    Avoid describing yourself or your role in the game, and speak as if you are the game itself.
    Avoid describing what the player "can" do, instead encourage their imagination.
    Do not use asterisks for emphasis or formatting. Use plain text in your responses. If there is a speaker or a theme, introduce it using bold text.
    
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
    Do not start the game until the player introduces themself.
    `;

    const systemInstructions = `
    You are a fantasy dungeon master, experienced in running tabletop role-playing games.
    Be creative and descriptive. Be whimsical, but also consistent with the game's established lore.
    Keep the game moving and challenging, while also being fair. Focus on narrative, character development, and player interaction.
    Do not use asterisks for emphasis or formatting. Use plain text in your responses. If there is a speaker or a theme, introduce it using bold text.
    
    The game's story is: ${gameData.story}
    The lore is: ${gameData.lore}
    The game's goal is: ${gameData.goal}
    The player is currently in ${location.name}, ${location.description}. Available locations are: ${Object.keys(gameData.locations).join(", ")}
    Available enemies: ${Object.keys(gameData.enemies).join(", ")}. Available items: ${Object.keys(gameData.items).join(", ")}
    `;


    useEffect(() => {
        const initialMessage = {
           text: "Welcome to the world of adventure! Introduce yourself to begin.",
            sender: "ai",
            timestamp: new Date(),
          };
           setMessages([initialMessage]);
       }, []);

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
                prompt +=  `Now that you've introduced yourself, you can introduce the game story, location and your character.`;
            }else{
                prompt +=  `Player Input: ${input}\n`;
                prompt +=  `Do not start until the player introduces their character by saying "My name is [name]."`;
            }
        }else{
            prompt +=  `\n${systemInstructions}\nPlayer Input: ${input}\n`;
         }

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
             const text = response.text();
             const aiResponse = { text: text, sender: "ai", timestamp: new Date() };

             //Location change detection
              const locationChange = await detectLocationChange(text);
              if (locationChange) {
                setLocation(locationChange);
             }

            setMessages((prev) => [...prev, aiResponse]);
        } catch (error) {
            console.error("Gemini API error:", error);
             const errorMessage = { text: "Sorry, I am having trouble with that right now.", sender: "ai", timestamp: new Date() };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

 const detectLocationChange = async (text) => {
      const prompt = `
        Given the current location and the new message, determine if the player has changed locations. Only return the new location if the player has changed locations.
        Current Location: ${location.name}
        Available Locations: ${Object.keys(gameData.locations).join(", ")}.
        New message: ${text}
        
        If the player has changed locations, return ONLY the new location object in a JSON format (example: { "name": "Dungeon", "description": "a dark and mysterious underground complex" }), otherwise return null
        Do not return text other than the JSON or null.
       `;
      
    try {
           const result = await model.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();
        
            if (responseText.startsWith("{")){
                try{
                    const locationChange = JSON.parse(responseText)
                    if (gameData.locations[locationChange.name]) return locationChange
                    else return null
                }catch (e){
                    return null
                }
            }
            return null;
       }catch (error){
        console.error("Gemini API location detection error:", error);
        return null;
       }

  }

    return (
        <div className="chat-level-container">
            {/* Chat Section */}
            <div className="chat-container">
                <div className="chat-header">
                    <h1>FABLE ENGINE v0.1</h1>
                </div>
                <div className="chat-messages">
                    {messages.map((msg, index) => (
                        <div
                            key={index}
                            className={`message ${msg.sender === "user" ? "user" : "ai"}`}
                        >
                            <p>{msg.text}</p>
                            <span className="timestamp">
                                {msg.timestamp.toLocaleTimeString()}
                            </span>
                        </div>
                    ))}
                    {isTyping && (
                        <div className="message ai">
                            <p>...</p>
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
                        {isTyping ? 'Loading...' : 'Send'}
                    </button>
                </div>
            </div>

            {/* Level Info Section */}
            <div className="level-info">
                <h2>Level 1</h2>
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
            </div>
        </div>
    );
};

export default ChatScreenWithLevel;