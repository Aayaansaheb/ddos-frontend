 // Use an IIFE (Immediately Invoked Function Expression) to avoid polluting the global scope
        (() => {
            const globeContainer = document.getElementById('globe-container');
            const liveFeed = document.getElementById('live-feed');
            let attacksData = [];
            const MAX_ATTACKS_IN_FEED = 15;
            
            // Modal elements
            const analysisModal = document.getElementById('analysis-modal');
            const closeModalBtn = document.getElementById('close-modal-btn');
            const modalAttackInfo = document.getElementById('modal-attack-info');
            const geminiResponseContainer = document.getElementById('gemini-response');
            const readAloudBtn = document.getElementById('read-aloud-btn');
            
            // --- 1. GLOBE INITIALIZATION ---
            // This code runs after the globe.gl script has been loaded and parsed.
            const world = Globe()
                (globeContainer)
                .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
                .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
                .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
                .arcsData(attacksData)
                .arcStartLat(d => d.source.lat)      //  <-- ADDED: Tell globe where to find start latitude
                .arcStartLng(d => d.source.lng)      //  <-- ADDED: Tell globe where to find start longitude
                .arcEndLat(d => d.destination.lat)        //  <-- ADDED: Tell globe where to find end latitude
                .arcEndLng(d => d.destination.lng)        //  <-- ADDED: Tell globe where to find end longitude
                .arcColor(arc => arc.color)
                .arcDashLength(0.4)
                .arcDashGap(0.1)
                .arcDashAnimateTime(1500)
                .arcStroke(0.5)
                .arcLabel(arc => `${arc.type} from ${arc.source.country} to ${arc.destination.country}`);

            world.controls().autoRotate = true;
            world.controls().autoRotateSpeed = 0.5;
            
            window.addEventListener('resize', () => {
                world.width(window.innerWidth);
                world.height(window.innerHeight);
            });

            // --- 2. WEBSOCKET CONNECTION ---
            const socket = io('https://ddos-backend-az9o.onrender.com', {
                transports: ['websocket'],
            });

            socket.on('connect', () => {
                console.log('Successfully connected to WebSocket server!');
                const firstElement = liveFeed.querySelector('p');
                if(firstElement && firstElement.textContent.includes('Awaiting connection')) {
                     liveFeed.innerHTML = '<p class="text-green-500">Connection established. Waiting for data...</p>';
                }
            });

            socket.on('disconnect', () => {
                 liveFeed.innerHTML = '<p class="text-yellow-500">Connection lost. Attempting to reconnect...</p>';
            });
            
             socket.on('connect_error', (error) => {
                const firstElement = liveFeed.querySelector('p');
                 if (firstElement && firstElement.textContent.includes('Awaiting connection')) {
                    liveFeed.innerHTML = '<p class="text-red-500">Failed to connect to the server. Is it running?</p>';
                 }
            });

            // --- 3. HANDLING INCOMING ATTACK DATA ---
            socket.on('new-attack', (attack) => {
                const firstElement = liveFeed.querySelector('p');
                if (firstElement && (firstElement.textContent.includes('Waiting for data') || firstElement.textContent.includes('established'))) {
                    liveFeed.innerHTML = '';
                }
                
                const attackColors = {
                    'UDP Flood': '#FFA500',   'SYN Flood': '#FF4500',
                    'HTTP GET': '#1E90FF', 'DNS Amplification': '#DC143C'
                };
                attack.color = attackColors[attack.type] || '#FFFFFF'; 

                attacksData.unshift(attack);
                if (attacksData.length > 30) attacksData.pop();

                world.arcsData(attacksData);
                updateLiveFeed(attack);
            });

            // --- 4. UI UPDATE & MODAL HANDLING ---
            function updateLiveFeed(attack) {
                const feedElement = document.createElement('div');
                feedElement.className = 'flex items-center space-x-2 animate-pulse cursor-pointer p-1 rounded-md hover:bg-gray-700 transition-colors';
                
                const sourceFlag = countryToFlag(attack.source.country);
                const destFlag = countryToFlag(attack.destination.country);
                
                feedElement.innerHTML = `
                    <div class="w-2 h-2" style="background-color: ${attack.color}; border-radius: 50%;"></div>
                    <span>${sourceFlag} ${attack.source.country} &rarr; ${destFlag} ${attack.destination.country} (${attack.type})</span>`;
                
                // Add click listener to open modal and trigger Gemini analysis
                feedElement.addEventListener('click', () => handleAttackClick(attack));
                
                liveFeed.prepend(feedElement);
                setTimeout(() => feedElement.classList.remove('animate-pulse'), 1000);
                if (liveFeed.children.length > MAX_ATTACKS_IN_FEED) {
                    liveFeed.removeChild(liveFeed.lastChild);
                }
            }
            
            closeModalBtn.addEventListener('click', () => {
                analysisModal.classList.add('hidden');
            });
            
            async function handleAttackClick(attack) {
                modalAttackInfo.innerHTML = `Analyzing <strong>${attack.type}</strong> from <strong>${attack.source.country}</strong> to <strong>${attack.destination.country}</strong>...`;
                geminiResponseContainer.innerHTML = '<div class="flex justify-center items-center h-full"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-red-400"></div></div>';
                analysisModal.classList.remove('hidden');
                
                // Unbind any previous listener
                const newReadAloudBtn = readAloudBtn.cloneNode(true);
                readAloudBtn.parentNode.replaceChild(newReadAloudBtn, readAloudBtn);
                
                try {
                    const explanation = await getGeminiExplanation(attack);
                    geminiResponseContainer.textContent = explanation;
                    newReadAloudBtn.onclick = () => handleReadAloud(explanation);
                    newReadAloudBtn.disabled = false;
                } catch (error) {
                    console.error("Gemini Error:", error);
                    geminiResponseContainer.textContent = 'Failed to get analysis. Please check the console for details.';
                    newReadAloudBtn.disabled = true;
                }
            }


            // --- 5. GEMINI API INTEGRATION ---
            const API_KEY = "AIzaSyBoS9IKCDiiAflVubJVMiCTfNqeaTqQ1i0"; // Leave blank, will be handled by the environment
            const TEXT_MODEL = "gemini-2.5-flash-preview-05-20";
            const TTS_MODEL = "gemini-2.5-flash-preview-tts";

            async function getGeminiExplanation(attack) {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${API_KEY}`;
                
                const systemPrompt = "You are a helpful cybersecurity analyst. Your goal is to explain cyber attack concepts in a clear, concise, and easy-to-understand way for a non-technical audience. Do not use jargon without explaining it. Keep responses to a single paragraph.";
                const userQuery = `Explain what a '${attack.type}' attack is in simple terms. The simulated attack is from ${attack.source.country} to ${attack.destination.country}. What could be a potential motivation for this type of attack?`;
                
                const payload = {
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userQuery }] }],
                };

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`API call failed with status: ${response.status}`);
                }

                const result = await response.json();
                return result.candidates?.[0]?.content?.parts?.[0]?.text || "No explanation available.";
            }

            async function handleReadAloud(textToRead) {
                const button = document.getElementById('read-aloud-btn');
                button.disabled = true;
                button.innerHTML = 'Generating...';

                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${API_KEY}`;
                const payload = {
                    contents: [{ parts: [{ text: `Say with a clear, informative tone: ${textToRead}` }] }],
                    generationConfig: { responseModalities: ["AUDIO"] },
                };

                try {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (!response.ok) throw new Error(`TTS API Error: ${response.status}`);

                    const result = await response.json();
                    const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    const mimeType = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;

                    if (audioData && mimeType && mimeType.startsWith("audio/")) {
                        const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                        const pcmData = base64ToArrayBuffer(audioData);
                        const pcm16 = new Int16Array(pcmData);
                        const wavBlob = pcmToWav(pcm16, sampleRate);
                        const audioUrl = URL.createObjectURL(wavBlob);
                        
                        const audio = new Audio(audioUrl);
                        audio.play();
                        audio.onended = () => {
                           button.disabled = false;
                           button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-volume-up" viewBox="0 0 16 16"><path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/><path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg> Read Aloud';
                        };
                    } else {
                        throw new Error("No audio data received.");
                    }
                } catch(error) {
                    console.error("TTS Error:", error);
                    button.disabled = false;
                    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-volume-up" viewBox="0 0 16 16"><path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/><path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg> Read Aloud';
                }
            }
            
            // --- 6. UTILITY FUNCTIONS ---
            function base64ToArrayBuffer(base64) {
                const binaryString = window.atob(base64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                return bytes.buffer;
            }

            function pcmToWav(pcmData, sampleRate) {
                const header = new ArrayBuffer(44);
                const view = new DataView(header);
                // RIFF chunk descriptor
                writeString(view, 0, 'RIFF');
                view.setUint32(4, 36 + pcmData.byteLength, true);
                writeString(view, 8, 'WAVE');
                // "fmt " sub-chunk
                writeString(view, 12, 'fmt ');
                view.setUint32(16, 16, true); // Subchunk1Size
                view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
                view.setUint16(22, 1, true); // NumChannels
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * 2, true); // ByteRate
                view.setUint16(32, 2, true); // BlockAlign
                view.setUint16(34, 16, true); // BitsPerSample
                // "data" sub-chunk
                writeString(view, 36, 'data');
                view.setUint32(40, pcmData.byteLength, true);

                return new Blob([header, pcmData], { type: 'audio/wav' });
            }

            function writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            }

            function countryToFlag(countryName) {
                const countryCode = getCountryCode(countryName);
                if (!countryCode) return '🏳️';
                return countryCode.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
            }

            function getCountryCode(countryName) {
                 const countryCodes = {
                    "United States": "US", "Russia": "RU", "China": "CN", "India": "IN", "Brazil": "BR",
                    "Germany": "DE", "United Kingdom": "GB", "France": "FR", "Japan": "JP", "Canada": "CA",
                     "Australia": "AU", "South Korea": "KR", "Netherlands": "NL", "Iran": "IR", "Turkey": "TR",
                     "Vietnam": "VN", "Poland": "PL", "Ukraine": "UA", "Taiwan": "TW", "Romania": "RO"
                };
                return countryCodes[countryName];
            }
        })();