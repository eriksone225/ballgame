   const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const resultModal = document.getElementById('resultModal');
        const resultText = document.getElementById('resultText');
        const themeBtn = document.getElementById('themeBtn');
        const soundBtn = document.getElementById('soundBtn');
        const gameContainer = document.getElementById('gameContainer');
        // --- CAMERA STATE (NEW) ---
const camera = {
    x: canvas.width / 2, // Center of world
    y: canvas.height / 2,
    zoom: 1.0,
    targetId: null // ID of fighter to follow
};

let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let globalMouseX = 0;
let globalMouseY = 0;

let fighterOverrides = {}; // Stores stats: { "p1_0": {hp: 2.0, dmg: 1.5} }
// --- BATTLE CHAOS SYSTEM ---
// 0 = almost deterministic
// 1 = recommended
// 2 = very chaotic
let BATTLE_CHAOS = 1.5;
let battleRunId = 0;

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function isChaosEligible(e) {
    if (!e) return false;
    if (e.type === 'turret' || e.type === 'boid') return false;
    return true;
}

function countEnemiesNearUnit(unit, radius) {
    if (!unit) return 0;

    return entities.filter(other =>
        other &&
        other.hp > 0 &&
        other.team !== unit.team &&
        other.id !== unit.id &&
        other.type !== 'turret' &&
        other.type !== 'boid' &&
        Math.sqrt((other.x - unit.x) ** 2 + (other.y - unit.y) ** 2) < radius
    ).length;
}

function getSurroundedDamageMultiplier(victim) {
    const nearbyEnemies = countEnemiesNearUnit(victim, 95);

    if (nearbyEnemies <= 2) return 1;

    // This creates "dogpile pressure" without instantly killing strong fighters.
    // Big mobs can sometimes overwhelm a strong unit, but not always.
    const pressure = Math.min(nearbyEnemies - 2, 16);
    return 1 + pressure * 0.035 * BATTLE_CHAOS;
}

function applyBattleChaosToFighter(e) {
    if (!isChaosEligible(e)) return;

    e.battleRunId = battleRunId;

    // Personality / execution stats for this one battle only
    e.battleLuck = randRange(0.85, 1.15);
    e.damageVariance = randRange(0.06, 0.16) * BATTLE_CHAOS;
    e.mistakeChance = randRange(0.002, 0.018) * BATTLE_CHAOS;
    e.clutchChance = randRange(0.002, 0.014) * BATTLE_CHAOS;
    e.aimError = randRange(0.00, 0.13) * BATTLE_CHAOS;
    e.decisionNoise = randRange(0.12, 0.38) * BATTLE_CHAOS;
    e.speedChaos = randRange(0.92, 1.08);

    // Small stat variance. Not enough to destroy balance, enough to make repeats differ.
    const hpVariance = randRange(0.92, 1.08);
    const dmgVariance = randRange(0.93, 1.07);

    e.maxHp *= hpVariance;
    e.hp = e.maxHp;
    e.dmgMult = (e.dmgMult || 1) * dmgVariance;

    // Small opening impulse so mirror matches split differently
    e.vx = randRange(-3.5, 3.5);
    e.vy = randRange(-3.5, 3.5);
}

// --- NEW DROPDOWN LOGIC ---

function setObstacleMode(val) {
    if (!isSetupPhase) {
        showCustomMessage('Notice', 'Cannot place items during battle. Hit RESET.');
        document.getElementById('obstacleSelect').value = isObstaclePlacement ? obstacleType : 'off'; // Revert
        return;
    }

    if (val === 'off') {
        isObstaclePlacement = false;
    } else {
        isObstaclePlacement = true;
        obstacleType = val;
        
        // Disable Weapon Placement if active
        if (isWeaponPlacement) {
            isWeaponPlacement = false;
            document.getElementById('weaponSelect').value = 'off';
        }

        // Show Help Message
        let msg = '';
        if (val === 'barrel') msg = 'Click to place Explosive Barrel (50 HP). Can be pushed!';
        if (val === 'rock') msg = 'Click to place Rock (120 HP). Blocks movement.';
        if (val === 'lava') msg = 'Click to place Lava. Deals damage over time.';
        if (val === 'spike') msg = 'Click to place Spikes (200 HP). Reflects damage.';
        if (val === 'ice') msg = 'Click to place Ice. Low friction.';
        if (val === 'mine') msg = 'Click to place Mine. Explodes on contact.';
        if (val === 'turret') msg = 'Click to place Turret. Shoots nearest target.';
        if (val === 'black_hole') msg = 'Click to place Black Hole. Sucks in units and curves projectiles!';
        showCustomMessage('Placement Mode', msg);
    }
}

function setWeaponMode(val) {
    // ALLOW placement if we are in Setup Phase OR if we are in Pet Mode
    if (!isSetupPhase && GAME_MODE !== 'pet') {
        showCustomMessage('Notice', 'Cannot place items during battle. Hit RESET.');
        document.getElementById('weaponSelect').value = isWeaponPlacement ? placementWeaponType : 'off'; 
        return;
    }

    if (val === 'off') {
        isWeaponPlacement = false;
    } else {
        isWeaponPlacement = true;
        placementWeaponType = val;

        // Disable Obstacle Placement if active
        if (isObstaclePlacement) {
            isObstaclePlacement = false;
            document.getElementById('obstacleSelect').value = 'off';
        }
        
        // --- NEW: Custom Name Logic ---
        let displayName = val;
        if (GAME_MODE === 'pet') {
            if (val === 'dagger') displayName = 'Apple';
            if (val === 'gun') displayName = 'Meat';
            if (val === 'scythe') displayName = 'Candy';
        } else {
            // Capitalize first letter for normal mode
            displayName = val.charAt(0).toUpperCase() + val.slice(1);
        }

        showCustomMessage('Weapon Mode', `Click to place ${displayName}. Right click to remove.`);
    }
}

// --- UPDATE CLEAR FUNCTIONS ---

function clearObstacles() {
    // 1. Clear array data
    obstacles = [];
    decals = [];
    projectiles = projectiles.filter(p => !p.isMine || p.team !== 0);
    entities = entities.filter(e => e.type !== 'turret' || e.team !== 0);

    // 2. Reset Logic flags
    isObstaclePlacement = false;
    
    // 3. FORCE DROPDOWN TO FIRST OPTION ("Off")
    const dropdown = document.getElementById('obstacleSelect');
    if (dropdown) {
        dropdown.selectedIndex = 0; // This is safer than setting .value
    } else {
        console.error("Could not find element with id 'obstacleSelect'");
    }
    
    // 4. Update UI counts if needed
    if (typeof updateLiveCounts === 'function') updateLiveCounts();
}

function clearWeapons() {
    // 1. Clear array data
    pickups = [];
    
    // 2. Reset Logic flags
    isWeaponPlacement = false;
    
    // 3. FORCE DROPDOWN TO FIRST OPTION ("Off")
    const dropdown = document.getElementById('weaponSelect');
    if (dropdown) {
        dropdown.selectedIndex = 0; // This is safer than setting .value
    } else {
        console.error("Could not find element with id 'weaponSelect'");
    }
}
        // --- 1v1 RESET LOGIC ---
function resetToDuel() {
    // 1. Reset the input values to 1
    document.getElementById('p1Count').value = 1;
    document.getElementById('p2Count').value = 1;
    
    // 2. Refresh the UI to show only 1 slot per side
    updateSquadUI();
    
    // 3. Optional: Reset the battle immediately so you see the change
    resetPositions(); 
}
        
        // --- GLOBAL STATE ---
        let isSetupPhase = true;
        let GAME_MODE = 'team'; // 'team' or 'ffa'
        let modalTimeout;
        
        // NEW GLOBAL STATE FOR OBSTACLES
        let obstacles = [];
        let pickups = []
        let isObstaclePlacement = false;
        let obstacleType = 'rock'; // 'rock', 'lava', 'spike'

        // --- GOD MODE STATE ---
let godPowerMode = 'none'; // 'none', 'lightning', 'heal', 'explosion'

function setGodPower(mode) {
    // 1. Reset other modes to prevent conflicts
    if (mode !== 'none') {
        isObstaclePlacement = false;
        document.getElementById('obstacleSelect').value = 'off';
        isWeaponPlacement = false;
        document.getElementById('weaponSelect').value = 'off';
    }

    // 2. Toggle logic (if clicking the same button, turn it off)
    if (godPowerMode === mode) {
        godPowerMode = 'none';
    } else {
        godPowerMode = mode;
    }

    // 3. Update UI Buttons
    document.querySelectorAll('.btn-god').forEach(btn => btn.classList.remove('active'));
    
    if (godPowerMode === 'lightning') document.getElementById('gp-zap').classList.add('active');
    if (godPowerMode === 'heal') document.getElementById('gp-heal').classList.add('active');
    if (godPowerMode === 'explosion') document.getElementById('gp-boom').classList.add('active');

    // 4. Show Feedback
    if (godPowerMode !== 'none') {
        showCustomMessage('God Mode', `Active: ${mode.toUpperCase()}. Click on the arena!`);
    }
}
        
        // --- AUDIO ENGINE ---
                // --- AUDIO ENGINE ---
        let soundEnabled = false;

        const AUDIO_DIR = 'sounds/';
        const AUDIO_EXT = 'wav'; // change to 'wav' if your files are WAV

        const SOUND_FILES = {
            // Existing code aliases
            hit: ['ball_hit_light', 'ball_hit_heavy'],
            clash: ['clash_metal'],
            shot: ['gunshot_arcade'],
            zap: ['electric_zap'],
            explosion: ['blast_explosion_big'],
            bat: ['bat_transform'],
            note: ['bard_note'],
            laser: ['laser_fire_burst'],

            // New specific sounds
            heavy_hit: ['ball_hit_heavy'],
            reload: ['reload_click'],
            explosion_small: ['blast_explosion_small'],
            laser_arming_short: ['laser_arming_short'],
            laser_arming_medium: ['laser_arming_medium'],
            laser_arming_death: ['laser_arming_death'],
            laser_fire_loop: ['laser_fire_loop'],
            laser_fire_burst: ['laser_fire_burst'],
            arrow: ['arrow_shot'],
            flaming_arrow: ['flaming_arrow_shot'],
            cannon: ['cannon_fire'],
            heal: ['heal_chime'],
            portal: ['portal_open'],
            trap: ['trap_snap'],
            mine_arm: ['mine_arm'],
            mine_trigger: ['mine_trigger'],
            turret: ['turret_shot'],
            equip: ['equip_weapon'],
            death: ['death_pop'],
            slash: ['blade_slash'],
            dash: ['samurai_dash'],
            dual_shot: ['dual_gunshot']
        };

        const SOUND_VOLUME = {
            hit: 0.55,
            heavy_hit: 0.75,
            clash: 0.55,
            shot: 0.45,
            dual_shot: 0.45,
            reload: 0.5,
            zap: 0.45,
            explosion: 0.75,
            explosion_small: 0.6,
            bat: 0.55,
            note: 0.45,
            laser: 0.5,
            laser_fire_loop: 0.55,
            laser_fire_burst: 0.55,
            arrow: 0.45,
            flaming_arrow: 0.5,
            cannon: 0.75,
            heal: 0.55,
            portal: 0.6,
            trap: 0.6,
            mine_arm: 0.5,
            mine_trigger: 0.5,
            turret: 0.35,
            equip: 0.6,
            death: 0.65,
            slash: 0.55,
            dash: 0.55
        };

        // Prevents rapid-fire sounds from becoming ear-destroying
        const SOUND_COOLDOWN = {
            hit: 45,
            heavy_hit: 80,
            clash: 80,
            shot: 35,
            dual_shot: 80,
            reload: 300,
            zap: 90,
            explosion: 180,
            explosion_small: 120,
            bat: 300,
            note: 200,
            laser: 250,
            laser_fire_loop: 900,
            laser_fire_burst: 180,
            arrow: 80,
            flaming_arrow: 120,
            cannon: 300,
            heal: 250,
            portal: 350,
            trap: 250,
            mine_arm: 300,
            mine_trigger: 250,
            turret: 90,
            equip: 250,
            death: 120,
            slash: 80,
            dash: 120
        };

                const soundCache = {};
        const lastSoundAt = {};

        // --- BGM + VOLUME MIXER ---
        let masterVolume = 1.0;
        let musicVolume = 0.45;
        let battleVolume = 1.0; // combat SFX volume

        const BGM_FILES = {
            menu: 'sounds/menu_bgm.wav',
            battle: 'sounds/battle_bgm.wav'
        };

        let bgmAudio = null;
        let currentBgmType = null;

        function updateVolumeLabels() {
            const masterLabel = document.getElementById('masterVolumeLabel');
            const musicLabel = document.getElementById('musicVolumeLabel');
            const battleLabel = document.getElementById('battleVolumeLabel');

            if (masterLabel) masterLabel.innerText = Math.round(masterVolume * 100) + '%';
            if (musicLabel) musicLabel.innerText = Math.round(musicVolume * 100) + '%';
            if (battleLabel) battleLabel.innerText = Math.round(battleVolume * 100) + '%';
        }

        function updateAllVolumes() {
            if (bgmAudio) {
                bgmAudio.volume = Math.max(0, Math.min(1, masterVolume * musicVolume));
            }

            updateVolumeLabels();
        }

        function setMasterVolume(value) {
            masterVolume = parseFloat(value);
            updateAllVolumes();
        }

        function setMusicVolume(value) {
            musicVolume = parseFloat(value);
            updateAllVolumes();
        }

        function setBattleVolume(value) {
            battleVolume = parseFloat(value);
            updateAllVolumes();
        }

        function playBGM(type) {
            if (!soundEnabled) return;
            if (!BGM_FILES[type]) return;

            if (currentBgmType === type && bgmAudio && !bgmAudio.paused) {
                updateAllVolumes();
                return;
            }

            if (bgmAudio) {
                bgmAudio.pause();
                bgmAudio.currentTime = 0;
            }

            currentBgmType = type;
            bgmAudio = new Audio(BGM_FILES[type]);
            bgmAudio.loop = true;
            bgmAudio.preload = 'auto';

            updateAllVolumes();

            bgmAudio.play().catch(err => {
                console.warn(`Could not play BGM "${type}":`, err);
            });
        }

        function stopBGM() {
            if (bgmAudio) {
                bgmAudio.pause();
                bgmAudio.currentTime = 0;
            }

            currentBgmType = null;
        }

        function makeAudio(fileName) {
            const audio = new Audio(`${AUDIO_DIR}${fileName}.${AUDIO_EXT}`);
            audio.preload = 'auto';
            return audio;
        }

        function preloadSounds() {
            Object.values(SOUND_FILES).flat().forEach(fileName => {
                if (!soundCache[fileName]) {
                    soundCache[fileName] = [
                        makeAudio(fileName),
                        makeAudio(fileName),
                        makeAudio(fileName),
                        makeAudio(fileName)
                    ];
                }
            });
        }

        function initAudio() {
            preloadSounds();
        }

                function toggleSound() {
            soundEnabled = !soundEnabled;

            if (soundEnabled) {
                initAudio();
                playBGM(isSetupPhase ? 'menu' : 'battle');
            } else {
                stopBGM();
            }

            soundBtn.innerText = soundEnabled ? "Sound: ON" : "Sound: OFF";
            soundBtn.classList.toggle('active', soundEnabled);
        }

        // --- ADVANCED MODE STATE ---
        let advancedMode = false;
let characterNamesEnabled = false;
let fighterNumbersEnabled = false;

const BALL_NAME_ADJECTIVES = [
    'Blazing', 'Lucky', 'Iron', 'Tiny', 'Feral', 'Cosmic', 'Turbo', 'Sneaky',
    'Golden', 'Wild', 'Crimson', 'Electric', 'Silent', 'Heavy', 'Rapid',
    'Frozen', 'Angry', 'Bouncy', 'Mystic', 'Rogue', 'Brave', 'Dusty',
    'Neon', 'Shadow', 'Solar', 'Lunar', 'Atomic', 'Stormy', 'Royal', 'Mad'
];

const BALL_NAME_NOUNS = [
    'Mochi', 'Crusher', 'Pebble', 'Vortex', 'Noodle', 'Sparks', 'Orbit',
    'Marble', 'Goblin', 'Comet', 'Bonk', 'Warden', 'Nova', 'Razor',
    'Bandit', 'Sprocket', 'Jelly', 'Chomper', 'Rascal', 'Pickle',
    'Nugget', 'Cinder', 'Glitch', 'Raptor', 'Pummel', 'Cyclone',
    'Bruiser', 'Quake', 'Mantis', 'Meteor'
];

let generatedBallNames = loadGeneratedBallNames();

function loadGeneratedBallNames() {
    try {
        return JSON.parse(localStorage.getItem('ballBattleGeneratedNames') || '{}');
    } catch (err) {
        return {};
    }
}

function saveGeneratedBallNames() {
    try {
        localStorage.setItem('ballBattleGeneratedNames', JSON.stringify(generatedBallNames));
    } catch (err) {
        // Ignore storage errors; names will still work for the current session.
    }
}

function clearGeneratedBallNames() {
    generatedBallNames = {};
    try {
        localStorage.removeItem('ballBattleGeneratedNames');
    } catch (err) {
        // Ignore storage errors.
    }
}

function getRandomTwoWordName() {
    const first = BALL_NAME_ADJECTIVES[Math.floor(Math.random() * BALL_NAME_ADJECTIVES.length)];
    const second = BALL_NAME_NOUNS[Math.floor(Math.random() * BALL_NAME_NOUNS.length)];
    return `${first} ${second}`;
}

function getPersistentBallName(side, index, type) {
    const key = `${GAME_MODE}:${side}:${index}:${type || 'unknown'}`;

    if (!generatedBallNames[key]) {
        generatedBallNames[key] = getRandomTwoWordName();
        saveGeneratedBallNames();
    }

    return generatedBallNames[key];
}

let projectileTrailsEnabled = true;

// --- FULLSCREEN FOLDABLE CONTROL STATE ---
const fullscreenPanelState = {
    hudCollapsed: false,
    cameraCollapsed: false
};

function syncSpeedButtons() {
    const currentSpeed = Number(BASE_GAME_SPEED);

    document.querySelectorAll('.fullscreen-speed-btn').forEach(btn => {
        const speed = Number(btn.dataset.speed);
        btn.classList.toggle('active', Math.abs(speed - currentSpeed) < 0.001);
    });

    document.querySelectorAll('.btn-time').forEach(btn => {
        const clickText = btn.getAttribute('onclick') || '';
        const match = clickText.match(/setTimeScale\(([^,\)]+)/);
        const speed = match ? Number(match[1]) : NaN;
        btn.classList.toggle('active', Math.abs(speed - currentSpeed) < 0.001);
    });
}

function getSpeedLabel() {
    const speed = Number(BASE_GAME_SPEED);
    if (speed === 0) return 'Paused';
    return `${speed}x`;
}

function applyFullscreenPanelClasses() {
    if (!gameContainer) return;

    const isFullscreen = isWatchFullscreenActive();

    // Only keep collapsed panel classes while the dedicated watch fullscreen mode is active.
    // This prevents the normal page camera bar from getting stuck in a half-collapsed state.
    gameContainer.classList.toggle('fs-hud-collapsed', isFullscreen && fullscreenPanelState.hudCollapsed);
    gameContainer.classList.toggle('fs-camera-collapsed', isFullscreen && fullscreenPanelState.cameraCollapsed);
}

function setFullscreenTimeScale(scale, btn) {
    setTimeScale(scale, btn || null);
    updateFullscreenHud();
}

function toggleFullscreenPanel(panelName) {
    if (!gameContainer) return;

    if (panelName === 'hud') {
        fullscreenPanelState.hudCollapsed = !fullscreenPanelState.hudCollapsed;
    }

    if (panelName === 'camera') {
        fullscreenPanelState.cameraCollapsed = !fullscreenPanelState.cameraCollapsed;
    }

    applyFullscreenPanelClasses();
    updateFullscreenHud();
}

function setFullscreenPanelDefaults() {
    if (!gameContainer) return;

    applyFullscreenPanelClasses();
    updateFullscreenHud();
}

function toggleCinematicCamera() {
    cinematicCameraEnabled = !cinematicCameraEnabled;

    const btn = document.getElementById('cineBtn');
    if (btn) {
        btn.innerText = cinematicCameraEnabled ? "Cine Cam: ON" : "Cine Cam: OFF";
        btn.classList.toggle('active', cinematicCameraEnabled);
    }

    if (cinematicCameraEnabled) {
        camera.targetId = null;
        updateTrackButtons();
    }

    if (typeof updateFullscreenHud === 'function') updateFullscreenHud();
}



function isTypingInTextField() {
    const active = document.activeElement;
    if (!active) return false;

    const tag = active.tagName ? active.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
}

function isWatchFullscreenActive() {
    return !!(
        gameContainer &&
        (
            document.fullscreenElement === gameContainer ||
            gameContainer.classList.contains('watch-fullscreen')
        )
    );
}

function getFullscreenBattleStatusText() {
    if (!entities || entities.length === 0) {
        return 'Setup Mode — pick fighters first';
    }

    const liveFighters = entities.filter(e =>
        e &&
        e.hp > 0 &&
        e.type !== 'turret' &&
        e.type !== 'boid' &&
        !e.parentId
    );

    if (GAME_MODE === 'ffa') {
        return `${isSetupPhase ? 'Setup' : (gameOverTriggered ? 'Battle Ended' : 'Battle Running')} — Alive: ${liveFighters.length}`;
    }

    const leftAlive = liveFighters.filter(e => e.team === 1).length;
    const rightAlive = liveFighters.filter(e => e.team === 2).length;

    if (isSetupPhase) return `Setup Mode — Left ${leftAlive} | Right ${rightAlive}`;
    if (gameOverTriggered) return `Battle Ended — Left ${leftAlive} | Right ${rightAlive}`;
    return `Battle Running — Left ${leftAlive} | Right ${rightAlive}`;
}

function updateFullscreenHud() {
    const isFullscreen = isWatchFullscreenActive();
    applyFullscreenPanelClasses();
    syncFullscreenSetupControls();

    const btn = document.getElementById('fullscreenBtn');
    const fightBtn = document.getElementById('fullscreenFightBtn');
    const cineBtn = document.getElementById('fullscreenCineBtn');
    const statusText = document.getElementById('fullscreenStatusText');
    const hudToggleBtn = document.getElementById('fullscreenHudToggleBtn');
    const cameraFoldBtn = document.getElementById('fullscreenCameraFoldBtn');
    const cameraPeekBtn = document.getElementById('fullscreenCameraPeekBtn');

    if (btn) {
        btn.innerText = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
        btn.classList.toggle('active', isFullscreen);
    }

    if (fightBtn) {
        if (gameOverTriggered) {
            fightBtn.innerText = 'Start Again';
            fightBtn.classList.remove('is-running');
        } else if (isSetupPhase) {
            fightBtn.innerText = 'Start Fight';
            fightBtn.classList.remove('is-running');
        } else {
            fightBtn.innerText = 'Restart';
            fightBtn.classList.add('is-running');
        }
    }

    if (cineBtn) {
        cineBtn.innerText = cinematicCameraEnabled ? 'Cine: ON' : 'Cine: OFF';
        cineBtn.classList.toggle('active', cinematicCameraEnabled);
    }

    if (hudToggleBtn) {
        hudToggleBtn.innerText = fullscreenPanelState.hudCollapsed ? 'Show HUD' : 'Hide HUD';
        hudToggleBtn.title = fullscreenPanelState.hudCollapsed ? 'Show fullscreen controls' : 'Fold fullscreen controls';
    }

    if (cameraFoldBtn) {
        // This button only appears while the dock is visible, so it should always be a hide action.
        cameraFoldBtn.innerText = 'Hide Cam';
        cameraFoldBtn.title = 'Hide camera controls';
    }

    if (cameraPeekBtn) {
        cameraPeekBtn.innerText = 'Show Cam';
        cameraPeekBtn.title = 'Show camera controls';
    }

    if (statusText) {
        statusText.innerText = `${getFullscreenBattleStatusText()} — Speed: ${getSpeedLabel()}`;
    }

    syncSpeedButtons();
}

function updateFullscreenButton(isFullscreen) {
    const btn = document.getElementById('fullscreenBtn');
    const exitBtn = document.getElementById('fullscreenExitBtn');

    if (btn) {
        btn.innerText = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
        btn.classList.toggle('active', isFullscreen);
    }

    if (exitBtn) {
        exitBtn.innerText = isFullscreen ? "Exit" : "Enter";
    }

    updateFullscreenHud();
}

function setWatchFullscreenState(isFullscreen) {
    document.body.classList.toggle('watch-fullscreen-active', isFullscreen);

    if (gameContainer) {
        gameContainer.classList.toggle('watch-fullscreen', isFullscreen);

        if (!isFullscreen) {
            fullscreenPanelState.hudCollapsed = false;
            fullscreenPanelState.cameraCollapsed = false;
            gameContainer.classList.remove('fs-hud-collapsed', 'fs-camera-collapsed');
        } else {
            setFullscreenPanelDefaults();
        }
    }

    updateFullscreenButton(isFullscreen);
}

function enterWatchFullscreen() {
    if (!gameContainer) return;

    // Start fullscreen with controls visible; the user can fold them again with H/C.
    fullscreenPanelState.hudCollapsed = false;
    fullscreenPanelState.cameraCollapsed = false;
    setWatchFullscreenState(true);

    if (gameContainer.requestFullscreen && document.fullscreenElement !== gameContainer) {
        gameContainer.requestFullscreen().catch(err => {
            console.warn('Browser fullscreen failed. Using theater fullscreen fallback:', err);
            setWatchFullscreenState(true);
        });
    }
}

function exitWatchFullscreen() {
    if (!gameContainer) return;

    if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => {
            console.warn('Could not exit fullscreen:', err);
            setWatchFullscreenState(false);
        });
    } else {
        setWatchFullscreenState(false);
    }
}

function toggleWatchFullscreen() {
    if (!gameContainer) return;

    if (isWatchFullscreenActive()) {
        exitWatchFullscreen();
        return;
    }

    enterWatchFullscreen();
}

function fullscreenFightAction() {
    if (gameOverTriggered) {
        playAgain();
    } else if (isSetupPhase) {
        beginBattle();
    } else {
        resetPositions();
        beginBattle();
    }

    updateFullscreenHud();
}

function fullscreenResetAction() {
    resetPositions();
    updateFullscreenHud();
}

function fullscreenCineAction() {
    toggleCinematicCamera();
    updateFullscreenHud();
}

function startFightFullscreen() {
    enterWatchFullscreen();
    fullscreenFightAction();
}

document.addEventListener('fullscreenchange', () => {
    setWatchFullscreenState(document.fullscreenElement === gameContainer);
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gameContainer && gameContainer.classList.contains('watch-fullscreen') && !document.fullscreenElement) {
        setWatchFullscreenState(false);
        return;
    }

    if (event.key && event.key.toLowerCase() === 'f' && !isTypingInTextField()) {
        toggleWatchFullscreen();
        return;
    }

    if (isWatchFullscreenActive() && !isTypingInTextField()) {
        const key = event.key ? event.key.toLowerCase() : '';

        if (key === 'h') {
            toggleFullscreenPanel('hud');
            return;
        }

        if (key === 'c') {
            toggleFullscreenPanel('camera');
            return;
        }
    }
});


function toggleSlowMoBigHit() {
    slowMoBigHitEnabled = !slowMoBigHitEnabled;

    const btn = document.getElementById('slowMoBtn');
    if (btn) {
        btn.innerText = slowMoBigHitEnabled ? "Big Hit Slow-Mo: ON" : "Big Hit Slow-Mo: OFF";
        btn.classList.toggle('active', slowMoBigHitEnabled);
    }
}
function getLivingFighterByStat(statName) {
    let bestEntity = null;
    let bestValue = -1;

    entities.forEach(ent => {
        if (!ent) return;
        if (ent.hp <= 0) return;
        if (ent.type === 'turret' || ent.type === 'boid') return;
        if (ent.parentId) return;

        const stat = battleStats[ent.id];
        if (!stat) return;

        const value = stat[statName] || 0;

        if (value > bestValue) {
            bestValue = value;
            bestEntity = ent;
        }
    });

    return bestEntity;
}

function getCinematicFighterFocus() {
    const living = getTrackableFighters('all');

    if (living.length === 0) return null;

    if (living.length <= 2) {
        return {
            x: living.reduce((sum, e) => sum + e.x, 0) / living.length,
            y: living.reduce((sum, e) => sum + e.y, 0) / living.length,
            label: 'FINAL FIGHTERS',
            zoom: getCameraZoomForFocus('duel')
        };
    }

    const biggestDamager = getLivingFighterByStat('damageDealt');
    const mostDamaged = getLivingFighterByStat('damageTaken');

    if (biggestDamager && mostDamaged && biggestDamager.id !== mostDamaged.id) {
        return {
            x: (biggestDamager.x + mostDamaged.x) / 2,
            y: (biggestDamager.y + mostDamaged.y) / 2,
            label: 'MAIN FIGHT',
            zoom: getCameraZoomForFocus('pair')
        };
    }

    if (biggestDamager) {
        return {
            x: biggestDamager.x,
            y: biggestDamager.y,
            label: 'TOP DAMAGER',
            zoom: getCameraZoomForFocus('single')
        };
    }

    if (mostDamaged) {
        return {
            x: mostDamaged.x,
            y: mostDamaged.y,
            label: 'UNDER PRESSURE',
            zoom: getCameraZoomForFocus('single')
        };
    }

    const randomFighter = living[Math.floor(Math.random() * living.length)];

    return {
        x: randomFighter.x,
        y: randomFighter.y,
        label: 'FIGHTER',
        zoom: getCameraZoomForFocus('single')
    };
}

function getCameraZoomForFocus(mode = 'single') {
    const arenaScale = Math.max(canvas.width / 600, canvas.height / 500);

    let baseZoom = 1.25;

    if (mode === 'single' || mode === 'death') baseZoom = 1.65;
    if (mode === 'tracked') baseZoom = 1.85;
    if (mode === 'pair') baseZoom = 1.35;
    if (mode === 'duel') baseZoom = 1.25;
    if (mode === 'boom') baseZoom = 1.18;

    return clamp(baseZoom + (arenaScale - 1) * 0.28, 1.0, 2.65);
}

function registerBigMoment(x, y, label = 'BIG HIT', priority = 'fighter') {
    if (!cinematicCameraEnabled) return;

    const priorityScore = {
        fighter: 1,
        hit: 2,
        death: 4,
        boom: 5
    }[priority] || 1;

    const isBigBoom =
        priority === 'boom' ||
        label === 'EXPLOSION' ||
        label === 'CANNON HIT' ||
        label === 'BIG BOOM';

    const isDeath =
        priority === 'death' ||
        label === 'DEATH' ||
        label === 'KO';

    if (!isBigBoom && !isDeath && priorityScore < 3) return;
    if (cinematicFocus.timer > 0 && priorityScore < (cinematicFocus.priority || 0)) return;

    cinematicFocus.x = x;
    cinematicFocus.y = y;
    cinematicFocus.timer = isDeath ? 75 : 55;
    cinematicFocus.label = label;
    cinematicFocus.priority = priorityScore;
    cinematicFocus.zoom = getCameraZoomForFocus(isDeath ? 'death' : 'boom');
}

function triggerSlowMoBigHit(frames = 30) {
    if (!slowMoBigHitEnabled) return;
    if (!gameActive || isSetupPhase) return;
    if (BASE_GAME_SPEED <= 0) return;
    if (slowMoCooldown > 0) return;

    slowMoTimer = frames;
    slowMoCooldown = 45;
    GAME_SPEED = 0.35;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function ensureBattleStat(entity) {
    if (!entity) return null;
    if (entity.type === 'turret' || entity.type === 'boid') return null;

    if (!battleStats[entity.id]) {
        battleStats[entity.id] = {
    id: entity.id,
    name: typeof getEntityName === 'function' ? getEntityName(entity) : entity.type,
    type: entity.type,
    color: entity.color || '#777',
    kills: 0,
            team: entity.team,
            damageDealt: 0,
            damageTaken: 0,
            shotsFired: 0,
            shotsHit: 0,
            spawnFrame: battleStartFrame || frameCount,
            deathFrame: null
        };
    }

    const stat = battleStats[entity.id];
    stat.color = entity.color || stat.color || '#777';

    if (stat.damageDealt === undefined) stat.damageDealt = 0;
    if (stat.damageTaken === undefined) stat.damageTaken = 0;
    if (stat.shotsFired === undefined) stat.shotsFired = 0;
    if (stat.shotsHit === undefined) stat.shotsHit = 0;
    if (stat.spawnFrame === undefined) stat.spawnFrame = battleStartFrame || frameCount;
    if (stat.deathFrame === undefined) stat.deathFrame = null;
    if (!stat.type) stat.type = entity.type;

    return stat;
}

function recordShot(shooter, count = 1) {
    const stat = ensureBattleStat(shooter);
    if (!stat) return;

    stat.shotsFired += count;
}

function recordShotHit(shooter) {
    const stat = ensureBattleStat(shooter);
    if (!stat) return;

    stat.shotsHit++;
}

function recordDamageForRecap(source, victim, amount) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    if (safeAmount <= 0 || !victim) return;

    const actualDamage = Math.min(victim.hp, safeAmount);

    if (source && source.id !== victim.id) {
        const sourceStat = ensureBattleStat(source);
        if (sourceStat) sourceStat.damageDealt += actualDamage;
    }

    const victimStat = ensureBattleStat(victim);
    if (victimStat) victimStat.damageTaken += actualDamage;
}

function recordDeathForRecap(victim) {
    const stat = ensureBattleStat(victim);
    if (!stat) return;

    if (stat.deathFrame === null) {
        stat.deathFrame = frameCount;
    }
}

function recordKillForRecap(victim) {
    if (!victim || victim.type === 'turret' || victim.type === 'boid') return;

    battleTotalKills++;

    if (victim.lastAttackerId && battleStats[victim.lastAttackerId]) {
        const killerStat = battleStats[victim.lastAttackerId];

        if (killerStat.team !== victim.team || GAME_MODE === 'ffa') {
            killerStat.kills++;
        }
    }
}

function getMvpStat() {
    let best = null;

    Object.values(battleStats).forEach(stat => {
        if (!best || stat.kills > best.kills) {
            best = stat;
        }
    });

    return best;
}

function getRecapTypeTag(type) {
    return String(type || '?')
        .split(/\s+/)
        .map(word => word[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

function buildFighterBadgeHTML(stat) {
    if (!stat) {
        return `
            <div style="
                width:52px;height:52px;border-radius:50%;
                background:#555;border:3px solid #aaa;
                display:flex;align-items:center;justify-content:center;
                font-weight:900;color:white;
            ">?</div>
        `;
    }

    const color = escapeHtml(stat.color || '#777');
    const tag = escapeHtml(getRecapTypeTag(stat.type));

    return `
        <div style="
            width:58px;height:58px;border-radius:50%;
            background:${color};
            border:3px solid rgba(255,255,255,.9);
            box-shadow:0 0 16px rgba(0,0,0,.45), inset -8px -10px 0 rgba(0,0,0,.18);
            display:flex;align-items:center;justify-content:center;
            font-weight:900;color:white;text-shadow:0 2px 4px rgba(0,0,0,.8);
            margin-right:12px;
        ">
            ${tag}
        </div>
    `;
}

function buildAwardCardHTML(title, stat, detailText) {
    return `
        <div class="recap-card wide" style="display:flex;align-items:center;text-align:left;">
            ${buildFighterBadgeHTML(stat)}
            <div>
                <span>${escapeHtml(title)}</span>
                <b>${detailText}</b>
            </div>
        </div>
    `;
}

function formatBattleTime(frames) {
    const seconds = Math.max(0, Math.round(frames / 60));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins <= 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
}

function buildBattleRecapHTML() {
    const stats = Object.values(battleStats);

    const mvp = getMvpStat();

    const biggestDamageDealer = stats.reduce((best, stat) => {
        if (!best || stat.damageDealt > best.damageDealt) return stat;
        return best;
    }, null);

    const longestSurvivor = stats.reduce((best, stat) => {
        const endFrame = stat.deathFrame === null ? frameCount : stat.deathFrame;
        const aliveFrames = endFrame - stat.spawnFrame;

        if (!best || aliveFrames > best.aliveFrames) {
            return { ...stat, aliveFrames };
        }

        return best;
    }, null);

    const mostAccurate = stats
        .filter(stat => stat.shotsFired >= 3)
        .map(stat => ({
            ...stat,
            accuracy: stat.shotsHit / stat.shotsFired
        }))
        .sort((a, b) => b.accuracy - a.accuracy)[0];

    const totalBattleTime = frameCount - battleStartFrame;

    const mvpText = mvp && mvp.kills > 0
        ? `${escapeHtml(mvp.name)} — ${mvp.kills} KO${mvp.kills === 1 ? '' : 's'}`
        : `No combat MVP`;

    const damageText = biggestDamageDealer && biggestDamageDealer.damageDealt > 0
        ? `${escapeHtml(biggestDamageDealer.name)} — ${Math.round(biggestDamageDealer.damageDealt)} dmg`
        : `No damage dealer`;

    const survivorText = longestSurvivor
        ? `${escapeHtml(longestSurvivor.name)} — ${formatBattleTime(longestSurvivor.aliveFrames)}`
        : `None`;

    const accuracyText = mostAccurate
        ? `${escapeHtml(mostAccurate.name)} — ${Math.round(mostAccurate.accuracy * 100)}% (${mostAccurate.shotsHit}/${mostAccurate.shotsFired})`
        : `No shooter qualified`;

    return `
        <div class="battle-recap">
            <div class="battle-recap-title">Battle Recap</div>

            <div class="battle-recap-grid">
                <div class="recap-card">
                    <span>Total KOs</span>
                    <b>${battleTotalKills}</b>
                </div>

                <div class="recap-card">
                    <span>Battle Time</span>
                    <b>${formatBattleTime(totalBattleTime)}</b>
                </div>

                <div class="recap-card wide">
                  ${buildAwardCardHTML('MVP', mvp, mvpText)}

${buildAwardCardHTML('Biggest Damage Dealer', biggestDamageDealer, damageText)}

${buildAwardCardHTML('Longest Survivor', longestSurvivor, survivorText)}

                <div class="recap-card wide">
                    <span>Most Accurate Shooter</span>
                    <b>${accuracyText}</b>
                </div>
            </div>
        </div>
    `;
}

function saveFavoriteSquads() {
    const data = {
        p1Count: parseInt(document.getElementById('p1Count').value) || 1,
        p2Count: parseInt(document.getElementById('p2Count').value) || 1,
        p1: Array.from(document.querySelectorAll('.p1-input')).map(input => input.value),
        p2: Array.from(document.querySelectorAll('.p2-input')).map(input => input.value)
    };

    localStorage.setItem('ballBattleFavoriteSquads', JSON.stringify(data));
    showCustomMessage('Favorite Squads', 'Current P1 and P2 squads saved.');
    if (typeof playSound === 'function') playSound('equip');
}

function loadFavoriteSquads() {
    const raw = localStorage.getItem('ballBattleFavoriteSquads');

    if (!raw) {
        showCustomMessage('Favorite Squads', 'No favorite squad saved yet.');
        return;
    }

    let data;

    try {
        data = JSON.parse(raw);
    } catch (err) {
        showCustomMessage('Favorite Squads', 'Saved squad data is broken.');
        return;
    }

    document.getElementById('p1Count').value = data.p1Count || 1;
    document.getElementById('p2Count').value = data.p2Count || 1;

    updateSquadUI();

    const p1Inputs = document.querySelectorAll('.p1-input');
    const p2Inputs = document.querySelectorAll('.p2-input');

    p1Inputs.forEach((input, index) => {
        input.value = data.p1[index] || '';
        input.dispatchEvent(new Event('input'));
    });

    p2Inputs.forEach((input, index) => {
        input.value = data.p2[index] || '';
        input.dispatchEvent(new Event('input'));
    });

    initializeSquads();
    resetPositions();

    showCustomMessage('Favorite Squads', 'Favorite squads loaded.');
    if (typeof playSound === 'function') playSound('equip');
}

function clearFavoriteSquads() {
    localStorage.removeItem('ballBattleFavoriteSquads');
    showCustomMessage('Favorite Squads', 'Favorite squads deleted.');
    if (typeof playSound === 'function') playSound('zap');
}

function addArenaObject(type, x, y) {
    if (type === 'mine') {
        projectiles.push({
            x, y,
            vx: 0,
            vy: 0,
            radius: 10,
            team: 0,
            ownerId: 'env',
            life: 999999,
            isMine: true,
            shooterId: 'env'
        });

        return;
    }

    if (type === 'turret') {
        spawnTurret(x, y, 0, 'env');
        return;
    }

    let obsProps = { radius: 25, mass: 1000, hp: 120, maxHp: 120 };

    if (type === 'barrel') {
        obsProps = {
            radius: 20,
            mass: 2.0,
            hp: 50,
            maxHp: 50,
            friction: 0.92,
            vx: 0,
            vy: 0
        };
    }

    if (type === 'lava') obsProps = { radius: 40, mass: 0, hp: 9999, maxHp: 9999 };
    if (type === 'spike') obsProps = { radius: 25, mass: 1000, hp: 200, maxHp: 200 };
    if (type === 'ice') obsProps = { radius: 45, mass: 0, hp: 9999, maxHp: 9999 };
    if (type === 'black_hole') obsProps = { radius: 30, mass: 9999, hp: 9999, maxHp: 9999 };

    obstacles.push({ x, y, type, ...obsProps });
}

function addRandomArenaObject(type, padding = 60) {
    let safe = false;
    let attempts = 0;
    let x = 0;
    let y = 0;

    while (!safe && attempts < 120) {
        attempts++;

        x = padding + Math.random() * (canvas.width - padding * 2);
        y = padding + Math.random() * (canvas.height - padding * 2);

        safe = true;

        for (const o of obstacles) {
            const d = Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2);
            if (d < o.radius + 55) {
                safe = false;
                break;
            }
        }

        if (safe) {
            for (const e of entities) {
                const d = Math.sqrt((x - e.x) ** 2 + (y - e.y) ** 2);
                if (d < e.radius + 55) {
                    safe = false;
                    break;
                }
            }
        }
    }

    if (safe) addArenaObject(type, x, y);
}

function applyArenaPreset(preset) {
    if (!isSetupPhase) {
        showCustomMessage('Arena Preset', 'Reset before changing arena presets.');
        return;
    }

    clearObstacles();

    const w = canvas.width;
    const h = canvas.height;

    if (preset === 'empty') {
        clearWeapons();
        showCustomMessage('Arena Preset', 'Empty Arena loaded.');
        return;
    }

    if (preset === 'chaos') {
        randomizeObstacles();
        scatterWeapons();
        showCustomMessage('Arena Preset', 'Chaos Arena loaded.');
        return;
    }

    if (preset === 'cover') {
        const coverPoints = [
            [w * 0.35, h * 0.30],
            [w * 0.65, h * 0.30],
            [w * 0.50, h * 0.50],
            [w * 0.35, h * 0.70],
            [w * 0.65, h * 0.70]
        ];

        coverPoints.forEach((point, index) => {
            addArenaObject(index % 2 === 0 ? 'rock' : 'barrel', point[0], point[1]);
        });

        showCustomMessage('Arena Preset', 'Cover Arena loaded.');
        return;
    }

    if (preset === 'minefield') {
        const rows = 4;
        const cols = 6;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (Math.random() < 0.82) {
                    const x = w * 0.18 + c * ((w * 0.64) / (cols - 1));
                    const y = h * 0.22 + r * ((h * 0.56) / (rows - 1));
                    addArenaObject('mine', x + randRange(-18, 18), y + randRange(-18, 18));
                }
            }
        }

        showCustomMessage('Arena Preset', 'Minefield loaded.');
        return;
    }

    if (preset === 'barrel_party') {
        const count = Math.max(10, Math.floor((w * h) / 42000));

        for (let i = 0; i < count; i++) {
            addRandomArenaObject('barrel', 70);
        }

        showCustomMessage('Arena Preset', 'Barrel Party loaded.');
        return;
    }
}

function toggleProjectileTrails() {
    projectileTrailsEnabled = !projectileTrailsEnabled;

    const btn = document.getElementById('trailBtn');
    if (btn) {
        btn.innerText = projectileTrailsEnabled ? "Trails: ON" : "Trails: OFF";
        btn.classList.toggle('active', projectileTrailsEnabled);
    }
}

function toggleCharacterNames() {
    characterNamesEnabled = !characterNamesEnabled;

    const btn = document.getElementById('nameBtn');
    if (btn) {
        btn.innerText = characterNamesEnabled ? "Names: ON" : "Names: OFF";
        btn.classList.toggle('active', characterNamesEnabled);
    }
}

function toggleFighterNumbers() {
    fighterNumbersEnabled = !fighterNumbersEnabled;

    const btn = document.getElementById('fighterNumberBtn');
    if (btn) {
        btn.innerText = fighterNumbersEnabled ? "Numbers: ON" : "Numbers: OFF";
        btn.classList.toggle('active', fighterNumbersEnabled);
    }
}

        function toggleAdvancedMode() {
            advancedMode = !advancedMode;
            const btn = document.getElementById('advBtn');
            btn.innerText = advancedMode ? "Adv. Mode: ON" : "Adv. Mode: Off";
            btn.classList.toggle('active', advancedMode);
        }

        // --- HIT STOP SETTINGS ---
let hitStopEnabled = false;

function toggleHitStop() {
    hitStopEnabled = !hitStopEnabled;
    const btn = document.getElementById('hitStopBtn');
    btn.innerText = hitStopEnabled ? "Hit Stop: ON" : "Hit Stop: OFF";
    btn.classList.toggle('active', hitStopEnabled);
}

// --- BLOOD SETTINGS ---
let bloodEnabled = false

function toggleBlood() {
    bloodEnabled = !bloodEnabled;
    const btn = document.getElementById('bloodBtn');
    btn.innerText = bloodEnabled ? "Blood: ON" : "Blood: OFF";
    btn.classList.toggle('active', bloodEnabled);
    
    // Optional: Clear existing blood when turned off?
    if (!bloodEnabled) decals = []; 
}

// --- CUT IN HALF SETTINGS ---
let cutInHalfEnabled = false;

function toggleCut() {
    cutInHalfEnabled = !cutInHalfEnabled;
    const btn = document.getElementById('cutBtn');
    btn.innerText = cutInHalfEnabled ? "Cut: ON" : "Cut: OFF";
    btn.classList.toggle('active', cutInHalfEnabled);
}

        // --- CAMERA CONTROLS (NEW) ---
function adjustZoom(amount) {
    camera.zoom += amount;
    // Clamp zoom levels (0.5x to 3.0x)
    if (camera.zoom < 0.5) camera.zoom = 0.5;
    if (camera.zoom > 3.0) camera.zoom = 3.0;
}

function resetCamera() {
    camera.zoom = 1.0;
    camera.targetId = null;
    camera.x = canvas.width / 2;  // Reset X position
    camera.y = canvas.height / 2; // Reset Y position
    updateTrackButtons(); 
}
function getTrackableFighters(teamFilter = 'all') {
    return entities
        .filter(e => {
            if (!e) return false;
            if (e.hp <= 0) return false;
            if (e.type === 'turret' || e.type === 'boid' || e.type === 'mammoth_mount') return false;
            if (e.parentId) return false;

            if (teamFilter === 1 && e.team !== 1) return false;
            if (teamFilter === 2 && e.team !== 2) return false;

            return true;
        })
        .sort((a, b) => {
            const sideOrder = side => {
                if (side === 'p1') return 0;
                if (side === 'p2') return 1;
                return 2;
            };

            const sideDiff = sideOrder(a.spawnSide) - sideOrder(b.spawnSide);
            if (sideDiff !== 0) return sideDiff;

            const indexA = a.spawnIndex ?? 9999;
            const indexB = b.spawnIndex ?? 9999;
            if (indexA !== indexB) return indexA - indexB;

            return a.team - b.team;
        });
}

function getFighterNumber(ent) {
    const list = getTrackableFighters('all');
    const index = list.findIndex(e => e.id === ent.id);
    return index >= 0 ? index + 1 : null;
}

function getFighterLabel(ent) {
    if (!ent) return "";

    const num = getFighterNumber(ent);
    const hasNumber = !!num;
    const baseName = ent.displayName || (hasNumber ? `Fighter ${num}` : "");

    if (characterNamesEnabled && fighterNumbersEnabled) {
        if (ent.displayName && hasNumber) return `${ent.displayName} ${num}`;
        return hasNumber ? `Fighter ${num}` : baseName;
    }

    if (characterNamesEnabled) {
        return baseName;
    }

    if (fighterNumbersEnabled) {
        return hasNumber ? `Fighter ${num}` : "";
    }

    return "";
}

function trackFighterByNumber(number) {
    const fighterNumber = parseInt(number);

    if (!fighterNumber || fighterNumber < 1) {
        showCustomMessage("Camera", "Enter a valid fighter number.");
        return;
    }

    const list = getTrackableFighters('all');
    const target = list[fighterNumber - 1];

    if (!target) {
        showCustomMessage("Camera", `No living Fighter ${fighterNumber} found.`);
        return;
    }

    camera.targetId = target.id;
    updateTrackButtons();
    showCustomMessage("Camera", `Tracking ${getFighterLabel(target)}: ${target.type.toUpperCase()}`);
}

function trackFighter(index, prefix) {
    const side = prefix; // 'p1' or 'p2'

    // Look for the fighter created from this specific input slot
    const target = entities.find(e => e.spawnSide === side && e.spawnIndex === index);
    
    if (target) {
        if (camera.targetId === target.id) {
            camera.targetId = null; // Toggle off
        } else {
            camera.targetId = target.id;
        }
    } else {
        camera.targetId = null;
    }
    updateTrackButtons();
}

function updateTrackButtons() {
    // 1. Turn off all eye highlights
    document.querySelectorAll('.btn-track').forEach(btn => btn.classList.remove('active'));
    
    if (!camera.targetId) return;
    
    // 2. Find the tracked entity
    const trackedEnt = entities.find(e => e.id === camera.targetId);
    
    // 3. Highlight the specific button that spawned this entity
    if (trackedEnt && trackedEnt.spawnSide) {
        const btnId = `track-btn-${trackedEnt.spawnSide}-${trackedEnt.spawnIndex}`;
        const btn = document.getElementById(btnId);
        if(btn) btn.classList.add('active');
    }
}

// UPDATED: Cycle Target with Team Filtering
function cycleTarget(teamFilter = 'all') {
    let candidates = getTrackableFighters(teamFilter);

    if (candidates.length === 0) {
        camera.targetId = null;
        updateTrackButtons();
        return;
    }

    let currentIndex = candidates.findIndex(e => e.id === camera.targetId);
    let nextIndex = (currentIndex + 1) % candidates.length;

    camera.targetId = candidates[nextIndex].id;
    updateTrackButtons();

    showCustomMessage("Camera", `Tracking ${getFighterLabel(candidates[nextIndex])}: ${candidates[nextIndex].type.toUpperCase()}`);
}

// Helper to find index for button highlighting
function getEntityIndex(ent) {
    // Simple filter to find index among teammates
    const teammates = entities.filter(e => e.team === ent.team && e.type !== 'turret' && e.type !== 'boid' && !e.parentId);
    return teammates.indexOf(ent);
}
        function toggleTheme() {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            themeBtn.innerText = isDark ? "Theme: Dark" : "Theme: Light";
        }
                function playSound(type, volumeMultiplier = 1) {
            if (!soundEnabled) return;

            const possibleFiles = SOUND_FILES[type];
            if (!possibleFiles) {
                console.warn(`Missing sound type: ${type}`);
                return;
            }

            const now = performance.now();
            const cooldown = SOUND_COOLDOWN[type] ?? 0;

            if (lastSoundAt[type] && now - lastSoundAt[type] < cooldown) {
                return;
            }

            lastSoundAt[type] = now;

            const fileName = possibleFiles[Math.floor(Math.random() * possibleFiles.length)];

            if (!soundCache[fileName]) {
                soundCache[fileName] = [
                    makeAudio(fileName),
                    makeAudio(fileName),
                    makeAudio(fileName),
                    makeAudio(fileName)
                ];
            }

            let audio = soundCache[fileName].find(a => a.paused || a.ended);

            // If all copies are busy, clone one more so rapid combat still works
            if (!audio) {
                audio = makeAudio(fileName);
                soundCache[fileName].push(audio);
            }

            audio.currentTime = 0;
                        audio.volume = Math.max(
                0,
                Math.min(1, (SOUND_VOLUME[type] ?? 0.5) * volumeMultiplier * masterVolume * battleVolume)
            );

            audio.play().catch(err => {
                // Browser may block sound until the user clicks Sound: ON
                console.warn(`Could not play sound "${type}":`, err);
            });
        }

        // --- KILL FEED LOGIC (MODIFIED) ---
        function logKill(killerName, victimName, killerTeam, verbPhrase, victimTeam) {
            const feed = document.getElementById('killFeed');
            const msg = document.createElement('div');
            msg.className = 'kill-message';
            
            // Determine colors for names
            let killerClass, victimClass;
            
            if (GAME_MODE === 'ffa') {
                killerClass = killerTeam === 0 ? 'highlight-env' : 'highlight-ffa';
                victimClass = 'highlight-ffa';
            } else {
                killerClass = killerTeam === 1 ? 'highlight-p1' : (killerTeam === 2 ? 'highlight-p2' : 'highlight-env');
                victimClass = victimTeam === 1 ? 'highlight-p1' : 'highlight-p2';
            }

            // Format: <VictimName> <Verb Phrase> <KillerName>
            msg.innerHTML = `<span class="${victimClass}">${victimName}</span> <span class="highlight-env">${verbPhrase}</span> <span class="${killerClass}">${killerName}</span>`;

            // Prepend the new message
            feed.prepend(msg);

            // Logic to gracefully fade out the oldest message without shifting the layout
            const maxMessages = 3;
            if (feed.children.length > maxMessages) {
                // The oldest message is now at index maxMessages (the 4th element)
                const oldestMsg = feed.children[maxMessages]; 
                
                // 1. Start the fade-out transition
                oldestMsg.style.opacity = '0';
                oldestMsg.style.transform = 'translateY(10px)'; // Optional slight slide down effect
                
                // 2. Remove it after the transition completes (500ms + buffer)
                setTimeout(() => {
                    // Check if it still exists and is the one we should remove
                    if (oldestMsg.parentNode === feed) {
                        oldestMsg.remove();
                    }
                }, 550); 
            }
            
            // Emergency cleanup: Ensures we don't build up too many messages if animations lag or are interrupted
            while (feed.children.length > maxMessages + 2) {
                feed.lastChild.remove();
            }
        }

        // --- GLOBAL UTILS ---
        function spawnParticles(x, y, color, count, type='dot') {
            for(let i=0; i<count; i++) {
                particles.push({
                    x: x, y: y,
                    vx: (Math.random()-0.5)*12, 
                    vy: (Math.random()-0.5)*12,
                    life: 45, alpha: 1, color: color,
                    type: type // 'dot' or 'note'
                });
            }
        }

        function isShatterProjectile(p) {
    return p && (p.type === 'bullet' || p.type === 'cannonball');
}

function spawnCannonImpactBurst(x, y, size = 1) {
        registerBigMoment(x, y, 'CANNON HIT', 'boom');
    triggerSlowMoBigHit(30);
    spawnParticles(x, y, 'orange', Math.floor(18 * size), 'dot');
    spawnParticles(x, y, 'red', Math.floor(10 * size), 'dot');
    spawnParticles(x, y, '#2b2b2b', Math.floor(10 * size), 'dot');
    spawnParticles(x, y, '#111', Math.floor(5 * size), 'dot');

    if (typeof playSound === 'function') playSound('explosion_small', 0.85);
    if (typeof triggerHitStop === 'function') triggerHitStop(4);
}

function shatterProjectile(p, impactType = 'wall') {
    if (!isShatterProjectile(p) || p.dead) return false;

    const isCannon = p.type === 'cannonball';

    p.dead = true;

    // Darker bullet shatter, heavier cannon debris
    let color = isCannon ? '#3a3a3a' : '#2b2b2b';
    let count = isCannon ? 26 : 9;

    if (impactType === 'spike') {
        color = isCannon ? '#4a4a4a' : '#1f1f1f';
        count += 5;
    }

    if (impactType === 'rock') {
        color = isCannon ? '#333333' : '#242424';
    }

    if (impactType === 'wall') {
        color = isCannon ? '#404040' : '#262626';
    }

    spawnParticles(p.x, p.y, color, count, 'dot');
    spawnParticles(p.x, p.y, '#111111', isCannon ? 10 : 4, 'dot');

    if (isCannon) {
        spawnCannonImpactBurst(p.x, p.y, 1.05);
        spawnDamageText(p.x, p.y - 12, 'BOOM', '#d0d0d0', true);
    } else {
        if (Math.random() < 0.35) {
            spawnDamageText(p.x, p.y - 10, 'PING', '#555');
        }

        if (typeof playSound === 'function') playSound('clash', 0.35);
    }

    return true;
}

function handleProjectileWallImpact(p) {
    if (!isShatterProjectile(p) || p.dead) return false;

    const pad = p.type === 'cannonball' ? 12 : 4;

    const hitWall =
        p.x <= pad ||
        p.x >= canvas.width - pad ||
        p.y <= pad ||
        p.y >= canvas.height - pad;

    if (!hitWall) return false;

    p.x = clamp(p.x, pad, canvas.width - pad);
    p.y = clamp(p.y, pad, canvas.height - pad);

    return shatterProjectile(p, 'wall');
}

function spawnMuzzleFlash(e, angle, kind = 'bullet') {
    if (!e) return;

    const size = kind === 'cannon' ? 1.8 : 1.0;

    muzzleFlashes.push({
        x: e.x + Math.cos(angle) * (e.radius + 8),
        y: e.y + Math.sin(angle) * (e.radius + 8),
        angle,
        life: kind === 'cannon' ? 7 : 4,
        maxLife: kind === 'cannon' ? 7 : 4,
        size,
        kind
    });
}

function updateMuzzleFlashes() {
    muzzleFlashes.forEach(f => f.life--);
    muzzleFlashes = muzzleFlashes.filter(f => f.life > 0);
}

function drawMuzzleFlashes() {
    muzzleFlashes.forEach(f => {
        const alpha = f.life / f.maxLife;

        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.angle);
        ctx.globalAlpha = alpha;

        // Outer flash
        ctx.fillStyle = f.kind === 'cannon' ? 'rgba(255,120,0,0.9)' : 'rgba(255,220,80,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(18 * f.size, -7 * f.size);
        ctx.lineTo(28 * f.size, 0);
        ctx.lineTo(18 * f.size, 7 * f.size);
        ctx.closePath();
        ctx.fill();

        // Inner white flash
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(12 * f.size, -3 * f.size);
        ctx.lineTo(18 * f.size, 0);
        ctx.lineTo(12 * f.size, 3 * f.size);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    });

    ctx.globalAlpha = 1;
}

        function triggerExplosion(x, y, radius, damage, sourceId) {
    registerBigMoment(x, y, 'EXPLOSION', 'boom');
    triggerSlowMoBigHit(30);

    playSound('explosion');
    spawnParticles(x, y, 'orange', 30);
    spawnParticles(x, y, 'red', 15);
    spawnParticles(x, y, '#444', 10); // Smoke
    let damageSource = sourceId ? entities.find(a => a.id === sourceId) : null;
    // 1. Damage Entities
    entities.forEach(e => {
        let dist = Math.sqrt((e.x - x)**2 + (e.y - y)**2);
        if (dist < radius) {
            let dmg = damage * (1 - dist / radius); // Damage falls off with distance
            damageEntity(e, dmg, x, y, damageSource);
            
            // Push them away
            let angle = Math.atan2(e.y - y, e.x - x);
            let force = (1 - dist/radius) * 15;
            e.vx += Math.cos(angle) * force;
            e.vy += Math.sin(angle) * force;
        }
    });

    // 2. Damage Other Obstacles (CHAIN REACTION LOGIC)
    obstacles.forEach(o => {
        if (o.type === 'barrel' || o.type === 'rock' || o.type === 'wall_trap') {
            let dist = Math.sqrt((o.x - x)**2 + (o.y - y)**2);
            if (dist < radius) {
                o.hp -= damage; // Hurt the other barrel
                
                // Push the other barrel
                if (o.type === 'barrel') {
                    let angle = Math.atan2(o.y - y, o.x - x);
                    let force = (1 - dist/radius) * 15;
                    o.vx += Math.cos(angle) * force;
                    o.vy += Math.sin(angle) * force;
                }
            }
        }
    });
}

        function spawnDecal(x, y, color) {

            if (!bloodEnabled) return;
    // Optional performance limit: Keep max 500 splatters to prevent lag
    if (decals.length > 500) decals.shift(); 

    // Create a splatter (3-5 small circles) to look organic
    const splatterCount = 3;
    
    for (let i = 0; i < splatterCount; i++) {
        decals.push({
            x: x + (Math.random() - 0.5) * 20, // Random spread
            y: y + (Math.random() - 0.5) * 20,
            radius: 5 + Math.random() * 8,     // Random size
            color: color,
            alpha: 0.5 + Math.random() * 0.3,  // Semi-transparent
            rotation: Math.random() * Math.PI * 2
        });
    }
}

                // NEW FUNCTION
        function spawnDamageText(x, y, amount, color='#fff', isCrit=false) {
    // FIX: Check if amount is a number or text
    let finalText = amount;

    if (typeof amount === 'number') {
        // If it's a number, check for NaN, otherwise round it
        finalText = isNaN(amount) ? "MISS" : Math.floor(amount);
    } 
    // If it's a string (like "RAGE!"), we leave it alone!

    damageText.push({
        x: x, y: y,
        text: finalText,
        life: 15,
        vy: -1.5, // Float up speed
        color: color,
        isCrit: isCrit,
        alpha: 1.0
    });
}
        
      function scatterWeapons() {
        
           if (!isSetupPhase && GAME_MODE !== 'pet') return; // Allow continuous spawning in Pet Mode

    // 1. Clear existing (Toggle behavior)
    if (GAME_MODE !== 'pet') pickups = []; 
    
    // 2. Random Count
    const count = 3 + Math.floor(Math.random() * 3); 
    
    // --- PET MODE LOGIC ---
    let types = ['dagger', 'gun', 'scythe'];
    if (GAME_MODE === 'pet') {
        // Limit total food on screen
        if (pickups.length > 15) return; 
        types = ['apple', 'meat', 'candy']; 
    }
            const padding = 60;
        
            for (let i = 0; i < count; i++) {
                let safe = false;
                let attempts = 0;
                let x, y;
        
                while (!safe && attempts < 100) {
                    attempts++;
                    x = padding + Math.random() * (canvas.width - padding * 2);
                    y = padding + Math.random() * (canvas.height - padding * 2);
                    safe = true;
                    
                    // 1. Avoid Obstacles
                    for (let o of obstacles) {
                        // 25 is weapon radius approx
                        if (Math.sqrt((x-o.x)**2 + (y-o.y)**2) < o.radius + 40) { safe = false; break; }
                    }

                    // 2. Avoid Other Weapons
                    if (safe) {
                        for (let p of pickups) {
                            if (Math.sqrt((x-p.x)**2 + (y-p.y)**2) < 50) { safe = false; break; }
                        }
                    }

                    // 3. Avoid Existing Fighters (If weapons are randomized after squad setup)
                    if (safe) {
                         for (let e of entities) {
                            if (Math.sqrt((x-e.x)**2 + (y-e.y)**2) < e.radius + 40) { safe = false; break; }
                         }
                    }
                }
        
                if (safe) {
            pickups.push({
                x: x, y: y,
                type: types[Math.floor(Math.random() * types.length)],
                radius: 12, // Slightly smaller for food
                angle: Math.random() * Math.PI * 2
            });
        }
    }
    if (typeof playSound === 'function' && GAME_MODE !== 'pet') playSound('clash');
}

function getAliveEnemiesFor(owner) {
    return entities.filter(ent =>
        ent &&
        ent.hp > 0 &&
        ent.team !== owner.team &&
        ent.id !== owner.id &&
        ent.type !== 'turret' &&
        ent.type !== 'boid' &&
        !ent.isStealthed &&
        !ent.isFeigning
    );
}

function getAliveAlliesNear(owner, x, y, radius) {
    return entities.filter(ent =>
        ent &&
        ent.hp > 0 &&
        ent.team === owner.team &&
        ent.id !== owner.id &&
        Math.sqrt((ent.x - x) ** 2 + (ent.y - y) ** 2) < radius
    );
}

function distanceBetween(a, b) {
    if (!a || !b) return 999999;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function clampArenaPoint(x, y, padding = 35) {
    return {
        x: clamp(x, padding, canvas.width - padding),
        y: clamp(y, padding, canvas.height - padding)
    };
}

function isDeploySpotClear(x, y, radius = 28, ownerId = null) {
    if (x < radius || x > canvas.width - radius || y < radius || y > canvas.height - radius) return false;

    for (const o of obstacles) {
        if (!o || o.type === 'lava' || o.type === 'ice') continue;
        if (Math.sqrt((o.x - x) ** 2 + (o.y - y) ** 2) < (o.radius || 20) + radius + 8) return false;
    }

    for (const ent of entities) {
        if (!ent || ent.hp <= 0) continue;
        if (ownerId && ent.id === ownerId) continue;
        if (Math.sqrt((ent.x - x) ** 2 + (ent.y - y) ** 2) < (ent.radius || 20) + radius + 8) return false;
    }

    return true;
}

function getEnemyCenterFor(owner) {
    const enemies = getAliveEnemiesFor(owner);
    if (enemies.length === 0) return { x: canvas.width / 2, y: canvas.height / 2 };

    return {
        x: enemies.reduce((sum, ent) => sum + ent.x, 0) / enemies.length,
        y: enemies.reduce((sum, ent) => sum + ent.y, 0) / enemies.length
    };
}

function findEngineerTurretSpot(engineer) {
    const enemies = getAliveEnemiesFor(engineer);
    const enemyCenter = getEnemyCenterFor(engineer);
    const baseAngle = Math.atan2(enemyCenter.y - engineer.y, enemyCenter.x - engineer.x);
    const candidates = [];

    const angleOffsets = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];
    const distances = [70, 115, 165, 220];

    angleOffsets.forEach(offset => {
        distances.forEach(dist => {
            candidates.push(clampArenaPoint(
                engineer.x + Math.cos(baseAngle + offset) * dist,
                engineer.y + Math.sin(baseAngle + offset) * dist,
                45
            ));
        });
    });

    const backAngle = baseAngle + Math.PI;
    candidates.push(clampArenaPoint(engineer.x + Math.cos(backAngle) * 160, engineer.y + Math.sin(backAngle) * 160, 45));

    let best = null;
    let bestScore = -999999;

    candidates.forEach(p => {
        if (!isDeploySpotClear(p.x, p.y, 22, engineer.id)) return;

        let nearestEnemyDist = 999999;
        let visibleEnemies = 0;

        enemies.forEach(enemy => {
            const d = Math.sqrt((enemy.x - p.x) ** 2 + (enemy.y - p.y) ** 2);
            nearestEnemyDist = Math.min(nearestEnemyDist, d);
            if (d < 520 && hasLineOfSight(p, enemy)) visibleEnemies++;
        });

        const ownedTurrets = entities.filter(ent => ent.type === 'turret' && ent.ownerId === engineer.id && ent.hp > 0);
        let nearestTurretDist = 999999;
        ownedTurrets.forEach(t => {
            nearestTurretDist = Math.min(nearestTurretDist, Math.sqrt((t.x - p.x) ** 2 + (t.y - p.y) ** 2));
        });

        const enemySpacingScore = -Math.abs(nearestEnemyDist - 320);
        const turretSpacingScore = Math.min(nearestTurretDist, 220);
        const losScore = visibleEnemies * 150;
        const safetyPenalty = nearestEnemyDist < 135 ? 600 : 0;
        const score = enemySpacingScore + turretSpacingScore + losScore - safetyPenalty;

        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    });

    return best || clampArenaPoint(engineer.x + Math.cos(baseAngle + Math.PI) * 70, engineer.y + Math.sin(baseAngle + Math.PI) * 70, 45);
}

function disperseEngineerTurrets(engineerId) {
    entities.forEach(ent => {
        if (ent.type === 'turret' && ent.ownerId === engineerId) {
            ent.hp = 0;
            ent.dispersed = true;
            spawnParticles(ent.x, ent.y, '#888', 14);
            spawnParticles(ent.x, ent.y, '#00c3ff', 6);
        }
    });
}

function isTrapSpotClear(x, y, ownerId, minGap = 72) {
    if (x < 25 || x > canvas.width - 25 || y < 25 || y > canvas.height - 25) return false;

    for (const trap of traps) {
        if (!trap || trap.life <= 0) continue;
        const gap = trap.ownerId === ownerId ? minGap : minGap * 0.65;
        if (Math.sqrt((trap.x - x) ** 2 + (trap.y - y) ** 2) < gap) return false;
    }

    for (const p of projectiles) {
        if (!p || !p.isMine || p.dead) continue;
        if (Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2) < minGap * 0.7) return false;
    }

    for (const o of obstacles) {
        if (!o || o.type === 'lava' || o.type === 'ice') continue;
        if (Math.sqrt((o.x - x) ** 2 + (o.y - y) ** 2) < (o.radius || 20) + 28) return false;
    }

    return true;
}

function findNonStackedTrapSpot(owner, preferredX, preferredY, aimAngle = null) {
    const first = clampArenaPoint(preferredX, preferredY, 28);
    if (isTrapSpotClear(first.x, first.y, owner.id, 72)) return first;

    const baseAngle = aimAngle ?? owner.angle ?? 0;
    const rings = [45, 75, 105, 140];
    const offsets = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

    for (const r of rings) {
        for (const offset of offsets) {
            const p = clampArenaPoint(
                preferredX + Math.cos(baseAngle + offset) * r,
                preferredY + Math.sin(baseAngle + offset) * r,
                28
            );

            if (isTrapSpotClear(p.x, p.y, owner.id, 72)) return p;
        }
    }

    return null;
}

function dropTrapForTrapper(owner, preferredX, preferredY, aimAngle = null) {
    const spot = findNonStackedTrapSpot(owner, preferredX, preferredY, aimAngle);
    if (!spot) return null;
    traps.push(createTrap(spot.x, spot.y, owner.team, owner.id));
    return spot;
}

function dropMineForTrapper(owner, preferredX, preferredY, aimAngle = null) {
    const spot = findNonStackedTrapSpot(owner, preferredX, preferredY, aimAngle);
    if (!spot) return null;

    const mine = createMine(spot.x, spot.y, owner.team, owner.id);
    mine.spawnedByFighter = true;
    projectiles.push(mine);
    return spot;
}

function clearFighterSpawnedHazards() {
    projectiles = projectiles.filter(p => !(p && p.isMine && p.ownerId !== 'env' && p.team !== 0));
    obstacles = obstacles.filter(o => !(o && (o.tactical || o.spawnedByFighter || (o.ownerId && o.ownerId !== 'env'))));
    traps = [];
}

function getFighterStrengthScore(ent) {
    if (!ent) return -999999;

    const data = FIGHTER_DATA && FIGHTER_DATA[ent.type] ? FIGHTER_DATA[ent.type] : {};
    const hpScore = (ent.maxHp || ent.hp || 0) * 1.4 + (ent.hp || 0);
    const massScore = (ent.mass || 1) * 28;
    const rangeScore = Math.min(ent.reach || 0, 500) * 0.08;
    const classBonus = (data.hp || 0) * 0.5;

    return hpScore + massScore + rangeScore + classBonus;
}

function getStrongestCopyTarget(chameleon) {
    const candidates = entities.filter(ent =>
        ent &&
        ent.team !== chameleon.team &&
        ent.hp > 0 &&
        ent.id !== chameleon.id &&
        ent.type !== 'boid' &&
        ent.type !== 'swarm' &&
        ent.type !== 'turret' &&
        ent.type !== 'chameleon' &&
        ent.realType !== 'chameleon' &&
        !ent.isStealthed &&
        !ent.isFeigning
    );

    candidates.sort((a, b) => getFighterStrengthScore(b) - getFighterStrengthScore(a));
    return candidates[0] || null;
}

function copyChameleonTarget(chameleon, target) {
    if (!target) return false;

    chameleon.type = target.type;
    chameleon.mimicTargetId = target.id;
    chameleon.isScanning = false;
    chameleon.morphTimer = 999999;

    applyClassProps(chameleon, chameleon.type);

    if (chameleon.type === 'soldier' || chameleon.type === 'dualist') {
        chameleon.state = 'ready';
        chameleon.fireTimer = 0;
        chameleon.reloadTimer = 0;
    }

    chameleon.hp = Math.min(chameleon.hp + 15, chameleon.maxHp);
    spawnParticles(chameleon.x, chameleon.y, 'lime', 15);
    playSound('zap');
    return true;
}

function findSoldierShootableBarrel(e) {
    if (!e || !e.target) return null;

    const enemy = e.target;
    let best = null;
    let bestScore = -999999;

    obstacles.forEach(o => {
        if (!o || o.type !== 'barrel' || o.hp <= 0) return;
        if (!hasLineOfSight(e, o)) return;

        const enemyDist = Math.sqrt((o.x - enemy.x) ** 2 + (o.y - enemy.y) ** 2);
        const shooterDist = Math.sqrt((o.x - e.x) ** 2 + (o.y - e.y) ** 2);

        if (enemyDist > 235) return;
        if (shooterDist > 850) return;

        const alliesNear = getAliveAlliesNear(e, o.x, o.y, 180).length;
        if (alliesNear > 0) return;

        const score = 300 - enemyDist - shooterDist * 0.08 + (o.tactical ? 35 : 0);

        if (score > bestScore) {
            bestScore = score;
            best = o;
        }
    });

    return best;
}


function findBestAdaptoBarrelTarget(e) {
    const enemies = getAliveEnemiesFor(e);
    if (enemies.length === 0) return null;

    let bestTarget = null;
    let bestScore = -999999;

    enemies.forEach(enemy => {
        const distToAdapto = Math.sqrt((enemy.x - e.x) ** 2 + (enemy.y - e.y) ** 2);
        if (distToAdapto > 560 || distToAdapto < 135) return;

        const enemyCluster = enemies.filter(other =>
            Math.sqrt((other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2) < 150
        ).length;

        const enemyDisabled =
            enemy.frozen > 0 ||
            enemy.isDancing ||
            enemy.isParanoid ||
            enemy.trappedBy;

        // Adapto should not waste barrels into a clean 1v1. He wants setup first:
        // flashbang/stun/trap OR a genuine cluster.
        if (!enemyDisabled && enemyCluster < 2) return;

        const alliesNearEnemy = getAliveAlliesNear(e, enemy.x, enemy.y, 210).length;
        const losBonus = hasLineOfSight(e, enemy) ? 80 : -80;

        const score =
            enemyCluster * 85 +
            (enemyDisabled ? 140 : 0) -
            alliesNearEnemy * 170 -
            distToAdapto * 0.12 +
            losBonus;

        if (score > bestScore && alliesNearEnemy === 0) {
            bestScore = score;
            bestTarget = enemy;
        }
    });

    return bestScore > 85 ? bestTarget : null;
}

function launchAdaptoBarrel(e, target) {
    if (!target) return;

    const speed = 6.2;
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    const timeToArrive = dist / speed;
    const predX = target.x + (target.vx || 0) * timeToArrive * 0.65;
    const predY = target.y + (target.vy || 0) * timeToArrive * 0.65;

    const angle = Math.atan2(predY - e.y, predX - e.x);

    const spawnX = e.x + Math.cos(angle) * (e.radius + 18);
    const spawnY = e.y + Math.sin(angle) * (e.radius + 18);

    obstacles.push({
        x: spawnX,
        y: spawnY,
        type: 'barrel',
        radius: 18,
        mass: 3.2,
        skin: 'adapto_tactical',
        spawnedByFighter: true,
        hp: 34,
        maxHp: 34,
        friction: 0.992,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,

        tactical: true,
        team: e.team,
        ownerId: e.id,
        proximityArmed: true,
        armTime: 72,
        detectionRadius: 52,
        tacticalFuse: 520
    });

    e.barrelCooldown = 520;

    spawnParticles(spawnX, spawnY, '#b2bec3', 8);
    spawnDamageText(e.x, e.y - 28, "TACTICAL BARREL", "#dfe6e9", true);

    if (typeof playSound === 'function') playSound('cannon', 0.65);
}

function findAdaptoShootableBarrel(e) {
    if (!e || !e.target) return null;

    let bestBarrel = null;
    let bestScore = -999999;

    obstacles.forEach(o => {
        if (o.type !== 'barrel') return;
        if (o.hp <= 0) return;
        if (!hasLineOfSight(e, o)) return;

        const enemyDist = Math.sqrt((o.x - e.target.x) ** 2 + (o.y - e.target.y) ** 2);
        const selfDist = Math.sqrt((o.x - e.x) ** 2 + (o.y - e.y) ** 2);
        const alliesNear = getAliveAlliesNear(e, o.x, o.y, 170).length;

        // Only shoot barrels that are useful and not too dangerous to allies
        if (enemyDist > 210) return;
        if (alliesNear > 0) return;

        const score = 260 - enemyDist - selfDist * 0.15 + (o.tactical ? 60 : 0);

        if (score > bestScore) {
            bestScore = score;
            bestBarrel = o;
        }
    });

    return bestBarrel;
}

function isValidEnemyTarget(attacker, target) {
    if (!attacker || !target) return false;
    if (!entities.includes(target)) return false;
    if (target.hp <= 0) return false;
    if (target.isStealthed || target.isFeigning) return false;
    if (target.id === attacker.id) return false;

    // If paranoid, the fighter can target anyone except itself
    if (attacker.isParanoid) return true;

    return target.team !== attacker.team;
}

function hasAnyLivingThreat(attacker) {
    return entities.some(ent => isValidEnemyTarget(attacker, ent));
}

function resetLaserState(e) {
    e.state = 'idle';
    e.timer = 0;
    e.laserWidth = 0;
    e.laserColor = null;
    e.laserChargeSoundPlayed = false;
    e.laserFireSoundPlayed = false;
}
        // --- LINE OF SIGHT CHECK (NEW) ---
        /**
         * Checks if there is a clear line of sight between two points (e1.x, e1.y) and (e2.x, e2.y), 
         * blocked by any active obstacle.
         */

        function hasLineOfSight(e1, e2) {
            if (obstacles.length === 0) return true;

            const dx = e2.x - e1.x;
            const dy = e2.y - e1.y;
            const distSq = dx * dx + dy * dy;

            for (const o of obstacles) {
                if (o.type === 'lava') continue; // Lava doesn't block LOS

                const t = ((o.x - e1.x) * dx + (o.y - e1.y) * dy) / distSq;
                
                let nearestX, nearestY;

                if (t < 0) { 
                    nearestX = e1.x;
                    nearestY = e1.y;
                } else if (t > 1) { 
                    nearestX = e2.x;
                    nearestY = e2.y;
                } else { 
                    nearestX = e1.x + t * dx;
                    nearestY = e1.y + t * dy;
                }

                const dObsX = o.x - nearestX;
                const dObsY = o.y - nearestY;
                const distToObsSq = dObsX * dObsX + dObsY * dObsY;

                if (distToObsSq < o.radius * o.radius) {
                    return false; // Line of sight is blocked
                }
            }

            return true; // No obstacles blocked the line of sight
        }


       // --- DRAG & DROP + PANNING HANDLING ---
let dragEntity = null;
let dragPickup = null; // NEW: To track held food

function getCursorPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }
    
    // Raw screen coordinates (for panning)
    const rawX = (clientX - rect.left) * (canvas.width / rect.width);
    const rawY = (clientY - rect.top) * (canvas.height / rect.height);

    // World coordinates (for entity dragging)
    const centeredX = (rawX - canvas.width / 2) / camera.zoom;
    const centeredY = (rawY - canvas.height / 2) / camera.zoom;

    return {
        x: centeredX + camera.x,
        y: centeredY + camera.y,
        rawX: rawX, 
        rawY: rawY
    };
}

// Function to handle single obstacle removal during setup
function removeObstacle(pos) {
    for (let i = obstacles.length - 1; i >= 0; i--) {
        let o = obstacles[i];
        let dist = Math.sqrt((pos.x - o.x)**2 + (pos.y - o.y)**2);
        if (dist < o.radius + 5) {
            obstacles.splice(i, 1);
            playSound('zap');
            return true;
        }
    }
    return false;
}

canvas.addEventListener('mousedown', startDrag);
canvas.addEventListener('touchstart', startDrag, {passive: false});

function removeMine(pos) {
    // Search projectiles specifically for mines
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        if (p.isMine) {
            let dist = Math.sqrt((pos.x - p.x)**2 + (pos.y - p.y)**2);
            if (dist < p.radius + 10) {
                projectiles.splice(i, 1);
                playSound('zap');
                return true;
            }
        }
    }
    return false;
}

function removeTurret(pos) {
    // Search entities specifically for turrets
    for (let i = entities.length - 1; i >= 0; i--) {
        let e = entities[i];
        if (e.type === 'turret') {
            let dist = Math.sqrt((pos.x - e.x)**2 + (pos.y - e.y)**2);
            if (dist < e.radius + 10) {
                entities.splice(i, 1);
                playSound('zap');
                return true;
            }
        }
    }
    return false;
}

function removeWeapon(pos) {
    for (let i = pickups.length - 1; i >= 0; i--) {
        let p = pickups[i];
        let dist = Math.sqrt((pos.x - p.x)**2 + (pos.y - p.y)**2);
        if (dist < p.radius + 10) {
            pickups.splice(i, 1);
            playSound('zap');
            return true;
        }
    }
    return false;
}

function startDrag(e) {
    const pos = getCursorPos(e);

    // GOD MODE CLICK
    if (godPowerMode !== 'none') {
        executeGodPower(pos);
        e.preventDefault();
        return;
    }
    
    let foundSomething = false;

    // --- 1. WEAPON / FOOD PLACEMENT ---
    // CHANGE: Check if it is Setup Phase OR Pet Mode
    if ((isSetupPhase || GAME_MODE === 'pet') && isWeaponPlacement) {
        
        if (e.button === 2) { 
            removeWeapon(pos); 
        } else {
            if (removeWeapon(pos)) { e.preventDefault(); return; }
            
            // LOGIC TO SWAP WEAPON FOR FOOD
            let typeToPlace = placementWeaponType;
            if (GAME_MODE === 'pet') {
                if (typeToPlace === 'dagger') typeToPlace = 'apple';
                else if (typeToPlace === 'gun') typeToPlace = 'meat';
                else if (typeToPlace === 'scythe') typeToPlace = 'candy';
            }

            pickups.push({
                x: pos.x, y: pos.y,
                type: typeToPlace,
                radius: 15,
                angle: Math.random() * Math.PI * 2
            });
            playSound('clash');
        }
        e.preventDefault();
        return;
    }

    // --- 2. OBSTACLE PLACEMENT ---
    if (isSetupPhase && isObstaclePlacement) {
        // ... (Keep your existing obstacle placement logic here, it is fine) ...
        // For brevity, I am not pasting the whole obstacle block again, 
        // just make sure you don't delete your existing Obstacle Block!
        if (e.button === 2) { 
            removeObstacle(pos); 
            removeMine(pos); 
            removeTurret(pos);
        } else {
             if (removeObstacle(pos) || removeMine(pos) || removeTurret(pos)) { e.preventDefault(); return; }
             // (Paste your existing Obstacle Add logic here)
             // ...
             let obsProps = { radius: 25, mass: 1000, hp: 120, maxHp: 120 };
             if (obstacleType === 'barrel') obsProps = { radius: 20, mass: 2.0, hp: 50, maxHp: 50, friction: 0.92, vx: 0, vy: 0 };
             // ... etc ...
             obstacles.push({ x: pos.x, y: pos.y, type: obstacleType, ...obsProps });
             playSound('clash');
        }
        e.preventDefault();
        return;
    }

    // --- 3. DRAG PICKUPS (FOOD) --- 
    // This allows you to pick up apples/meat to feed pets!
    for (let i = pickups.length - 1; i >= 0; i--) {
        let p = pickups[i];
        let dist = Math.sqrt((pos.x - p.x)**2 + (pos.y - p.y)**2);
        if (dist < p.radius + 10) {
            dragPickup = p; // Grab the food
            foundSomething = true;
            break;
        }
    }

    // --- 4. DRAG ENTITIES (PETS) ---
    if (!foundSomething) {
        for (let i = entities.length - 1; i >= 0; i--) {
            let ent = entities[i];
            if (ent.type === 'turret' || (ent.type === 'duplicator' && !ent.isOriginal) || ent.realType === 'boid') continue;

            let dist = Math.sqrt((pos.x - ent.x)**2 + (pos.y - ent.y)**2);
            if (dist < ent.radius + 15) { 
                dragEntity = ent;
                ent.vx = 0; ent.vy = 0; 
                ent.frozen = 5; // Keep them still while holding
                foundSomething = true;
                
                if(camera.targetId !== ent.id) camera.targetId = null; 
                updateTrackButtons();
                break;
            }
        }
    }

    // --- 5. CAMERA PAN ---
    if (!foundSomething) {
        isPanning = true;
        lastPanX = pos.rawX;
        lastPanY = pos.rawY;
        camera.targetId = null; 
        updateTrackButtons();
    }
}

canvas.addEventListener('mousemove', drag);
canvas.addEventListener('touchmove', drag, {passive: false});

function drag(e) {
    // Track mouse for Pet Mode AI
    const pos = getCursorPos(e);
    globalMouseX = pos.x;
    globalMouseY = pos.y;

    if (dragEntity) {
        e.preventDefault(); 
        dragEntity.x = pos.x;
        dragEntity.y = pos.y;
        dragEntity.vx = 0; dragEntity.vy = 0; dragEntity.frozen = 2; 
    } 
    else if (dragPickup) {
        // NEW: Move the food
        e.preventDefault();
        dragPickup.x = pos.x;
        dragPickup.y = pos.y;
    }
    else if (isPanning) {
        e.preventDefault();
        let dx = pos.rawX - lastPanX;
        let dy = pos.rawY - lastPanY;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        lastPanX = pos.rawX;
        lastPanY = pos.rawY;
    }
}

canvas.addEventListener('mouseup', endDrag);
canvas.addEventListener('touchend', endDrag);
canvas.addEventListener('mouseleave', endDrag);

function endDrag() {
    if (dragEntity) {
        // Optional: Give them a little toss when you let go
        dragEntity.frozen = 0; 
        dragEntity = null;
    }
    if (dragPickup) {
        dragPickup = null;
    }
    isPanning = false;
}

// Allow right-click on canvas for removal
canvas.addEventListener('contextmenu', function(e) {
     const pos = getCursorPos(e);
     
     if (isSetupPhase) {
        if (isObstaclePlacement) {
            removeObstacle(pos);
            removeMine(pos);   // Add this
            removeTurret(pos); // Add this
            e.preventDefault(); 
        } else if (isWeaponPlacement) {
            removeWeapon(pos);
            e.preventDefault();
        }
     }
}, false);
// --- END DRAG & DROP HANDLING ---


        // --- DATA (MODIFIED: Sorted) ---
        const FIGHTER_DATA = {
            'adapto': { hp: 140, dmg: 'Adaptive', ability: 'Tactical AI + Barrel Trap', desc: 'Adapts between sword, gun, shield, flashbangs, flanking, and tactical proximity barrels.' },
            'aquamarine': { hp: 105, dmg: 'Water', ability: 'Fish Swarm + Water Spray', desc: 'Summons biting fish and sprays water that damages and pushes enemies.' },
            'alchemist': { hp: 115, dmg: 'Debuff', ability: 'Chaos Potions', desc: 'Cycles potions: Poison > Slow > Blast.' },
            'bard': { hp: 90, dmg: 'Low', ability: 'Songs: Chaos & Dance', desc: 'Paranoia (Attack Friends) & Dance (Stun). Attacks with Guitar.' },
            'bow': { hp: 80, dmg: 'Medium', ability: 'Triple Shot & Fire', desc: 'Rapid arrows. Special: Flaming Arrow (Explodes + Burn) every 4s.' },
            'chameleon': { hp: 120, dmg: 'Adapt', ability: 'Tactical Copy', desc: 'Scans (0.8s). Heals on Morph (10s).' },
            'chrono': { hp: 90, dmg: 'Low', ability: 'Rewind', desc: 'Teleports back in time (2s) every 4s, restoring HP.' },
            'devourer': { hp: 100, dmg: 'Fatal', ability: 'Dampen & Feast', desc: 'Dampens enemies for 2s. Instakills if touching. Starves.' },
            'dualist': { hp: 110, dmg: 'Dual', ability: 'Dual Handgun Specialist', desc: 'Wields dual handguns. Shoots two targets at once.' },
            'duplicator': { hp: 80, dmg: 'Low', ability: 'Hive Mind (Max 12)', desc: '1s Dupe. 50% HP Clones. Stalemate breaker logic added.' },
            'fight knight': { hp: 140, dmg: 'Heavy', ability: 'Fake Death & Cleave', desc: 'Ignores pain. Feigns death at critical HP to ambush enemies. Uses a massive slab sword.' },
            'engineer': { hp: 90, dmg: 'Low', ability: 'Sentry Turrets', desc: 'Builds up to 6 stationary turrets that shoot foes. Avoids combat.' },
            'grabber': { hp: 125, dmg: 'Low', ability: 'Hook & Crush', desc: 'Slow Hook. Crushes for 35% Max HP over 2s. 3s Cooldown.' }, 
            'grower': { hp: 150, dmg: 'Scaling', ability: 'Infinite Growth', desc: 'Gets bigger, heavier, and stronger over time.' },
            'knight': { hp: 130, dmg: 'Medium', ability: 'Ram & Shield', desc: 'Shield blocks front. Ram (4s CD) deals 2x damage.' },
            'lance': { hp: 100, dmg: 'High', ability: 'Extending Reach', desc: 'Lance grows to snipe distant foes. Hits push enemies back.' },
            'laser': { hp: 90, dmg: 'Variable', ability: 'Pushback Laser', desc: 'Beams knock enemies far back. 3 Modes: Short, Med, Death.' },
            'mammoth': { hp: 135, dmg: 'Heavy', ability: 'Mammoth Rider', desc: 'Spawns and rides a mammoth. The mount tramples enemies and withers if the rider dies.' },
            'necromancer': { hp: 95, dmg: 'Blight', ability: 'Raise Dead', desc: 'Raises enemies dying nearby as Skeletons. Attacks with a withering beam.' },
            'orbiter': { hp: 100, dmg: 'High', ability: 'Orbiting Bits', desc: 'Shoots shield bits. Orbs deal 25 DMG and freeze foes for 1s.' },
            'pirate': { hp: 120, dmg: 'High', ability: 'Cannon & Dagger', desc: 'Aggressive. Fires Cannon (4s CD) while chasing.' },
            'regenerator': { hp: 200, dmg: 'Low', ability: 'Regeneration', desc: 'Heals constantly. Loses at 0 HP.' },
            'rogue': { hp: 90, dmg: 'High', ability: 'Ghost Form', desc: 'Invulnerable while Stealthed (2.5s CD). 2.5x Backstab.' },
            'samurai': { hp: 110, dmg: 'Burst', ability: 'Iaijutsu Dash', desc: 'Dashes through foes. Delayed massive damage cut.' },
            'scythe': { hp: 100, dmg: 'V. High', ability: 'Spin Attack (3s CD)', desc: 'Spins for 1s, then rests for 3s.' },
            'spearer': { hp: 105, dmg: 'Pierce', ability: 'Skewer Spear Kit', desc: 'Throws normal, explosive, and bouncing spears. Pins enemies near walls, objects, or other balls.' },
            'soldier': { hp: 110, dmg: 'High', ability: 'Burst Fire & Reload', desc: 'Cross-map range. Stops, aims, and fires a 3s burst. Then evades while reloading (2s).' }, 
            'spatial': { hp: 100, dmg: 'High', ability: 'Pinball Slam', desc: 'Traps up to 3 enemies. Slams between them rapidly. 4s CD.' }, 
            'swarm': { hp: 15, dmg: 'Swarm', ability: 'Boids AI', desc: 'A flock of 20 tiny units. Flocking behavior (Separate, Align, Cohere).' },
            'trapper': { hp: 95, dmg: 'Low/Trap', ability: 'Bear Traps & Mines', desc: 'Evades combat. Sets Bear Traps (Root 2s, Max 3) and explosive Mines (100 HP, 150px AOE). Uses dagger on trapped foes.' }, 
            'unarmed': { hp: 120, dmg: 'Medium/Tactical', ability: 'Environmental Brawler', desc: 'Uses walls & hazards. High Bravery = Aggressive Charges. Low Bravery = Baiting.' },
            'vampire': { hp: 110, dmg: 'LifeSteal', ability: 'Bat Form', desc: 'Heals on hit. Morphs into bat (invulnerable) for 2s.' },
            'whispers': { hp: 80, dmg: 'Psy', ability: 'Mind Control', desc: 'Forces enemies to betray or self-harm. Vulnerable on CD.' },
            'wizard': { hp: 80, dmg: 'Magic', ability: 'Quick Zap', desc: 'Slower enemies. Rapid fire (0.5s). Kites.' }
        };

        const FIGHTER_OPTIONS = Object.keys(FIGHTER_DATA).sort(); // SORTED ALPHABETICALLY

        const FIGHTER_VISUALS = {
    adapto: { tag: "AD", color: "#dfe6e9", accent: "#00cec9" },
    aquamarine: { tag: "AQ", color: "#00cec9", accent: "#81ecec" },
    alchemist: { tag: "AL", color: "#6c5ce7", accent: "#55efc4" },
    bard: { tag: "BD", color: "#a0522d", accent: "#fdcb6e" },
    bow: { tag: "BW", color: "#8b4513", accent: "#00cec9" },
    chameleon: { tag: "CH", color: "#00b894", accent: "#ffeaa7" },
    chrono: { tag: "CR", color: "#0984e3", accent: "#dfe6e9" },
    devourer: { tag: "DV", color: "#2d3436", accent: "#ff7675" },
    dualist: { tag: "DU", color: "#111111", accent: "#dfe6e9" },
    duplicator: { tag: "DP", color: "#74b9ff", accent: "#ffffff" },
    engineer: { tag: "EN", color: "#e17055", accent: "#fdcb6e" },
    "fight knight": { tag: "FK", color: "#2c3e50", accent: "#95a5a6" },
    grabber: { tag: "GR", color: "#6d4c41", accent: "#ffcc80" },
    grower: { tag: "GW", color: "#27ae60", accent: "#a3e635" },
    knight: { tag: "KN", color: "#95a5a6", accent: "#f1c40f" },
    lance: { tag: "LC", color: "#b2bec3", accent: "#636e72" },
    laser: { tag: "LZ", color: "#ff4757", accent: "#ffbe76" },
    mammoth: { tag: "MM", color: "#8d6e63", accent: "#d7ccc8" },
    mammoth_mount: { tag: "MT", color: "#6d4c41", accent: "#d7ccc8" },
    necromancer: { tag: "NC", color: "#2d3436", accent: "#55efc4" },
    orbiter: { tag: "OR", color: "#6c5ce7", accent: "#a29bfe" },
    pirate: { tag: "PR", color: "#2d3436", accent: "#e17055" },
    regenerator: { tag: "RG", color: "#00b894", accent: "#55efc4" },
    rogue: { tag: "RO", color: "#2d3436", accent: "#b2bec3" },
    samurai: { tag: "SM", color: "#d63031", accent: "#ff7675" },
    scythe: { tag: "SC", color: "#636e72", accent: "#dfe6e9" },
    spearer: { tag: "SR", color: "#7f8c8d", accent: "#f5f5dc" },
    soldier: { tag: "SD", color: "#34495e", accent: "#bdc3c7" },
    spatial: { tag: "SP", color: "#0984e3", accent: "#74b9ff" },
    swarm: { tag: "SW", color: "#fdcb6e", accent: "#2d3436" },
    trapper: { tag: "TR", color: "#636e72", accent: "#fab1a0" },
    unarmed: { tag: "UN", color: "#00c3ff", accent: "#ffffff" },
    vampire: { tag: "VP", color: "#6c0f1a", accent: "#ff7675" },
    whispers: { tag: "WH", color: "#4834d4", accent: "#dfe6e9" },
    wizard: { tag: "WZ", color: "#6c5ce7", accent: "#fd79a8" }
};

function titleCaseName(type) {
    return type
        .split(" ")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function getFighterVisual(type) {
    return FIGHTER_VISUALS[type] || {
        tag: type ? type.slice(0, 2).toUpperCase() : "??",
        color: "#747d8c",
        accent: "#ffffff"
    };
}

function fighterPortraitHTML(type, sizeClass = "") {
    const visual = getFighterVisual(type);
    const safeType = (type || "empty").replaceAll(" ", "-");

    return `
        <div class="fighter-portrait ${sizeClass} portrait-type-${safeType}" style="--portrait-color:${visual.color}; --portrait-accent:${visual.accent};">
            <div class="portrait-core">${visual.tag}</div>
            <div class="portrait-ring"></div>
            <div class="portrait-accessory"></div>
            <div class="portrait-weapon portrait-${safeType}"></div>
        </div>
    `;
}

        // --- GLOBAL SETTINGS ---
        let GLOBAL_DMG_MULT = 1.0;
        let GLOBAL_HP_MULT = 1.0;
       let GAME_SPEED = 1.0;
let BASE_GAME_SPEED = 1.0;
let speedAccumulator = 0; // NEW: For handling decimal speeds
let frameCount = 0;

// --- CINEMATIC / SLOW-MO / RECAP STATE ---
let cinematicCameraEnabled = false;
let slowMoBigHitEnabled = true;

let cinematicFocus = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    timer: 0,
    label: '',
    zoom: 1.0,
    priority: 0
};

let slowMoTimer = 0;
let slowMoCooldown = 0;

let battleStartFrame = 0;
let battleTotalKills = 0;

        function setTimeScale(scale, btn = null) {
    const numericScale = Number(scale);

    BASE_GAME_SPEED = numericScale;

    if (slowMoTimer <= 0) {
        GAME_SPEED = numericScale;
    }

    syncSpeedButtons();

    if (btn) {
        btn.classList.add('active');
    }

    if (typeof updateFullscreenHud === 'function') {
        updateFullscreenHud();
    }
}

        
let isWeaponPlacement = false;

// --- TOURNAMENT GLOBAL STATE ---
let tournamentData = {
    active: false,
    teams: [],      // Array of 16 teams
    round: 0,       // 0=Ro16, 1=Ro8, 2=Semis, 3=Finals
    matches: [],    // The bracket structure
    currentMatchIndex: 0
};
let isTournamentMatch = false; // Flag to tell the game engine we are in a tourney

// Helper to generate a random team name
const TEAM_PREFIXES = ["Iron", "Shadow", "Crimson", "Azure", "Savage", "Noble", "Cyber", "Mystic", "Royal", "Dark"];
const TEAM_SUFFIXES = ["Wolves", "Knights", "Snakes", "Dragons", "Guard", "Legion", "Strikers", "Titans", "Bears", "Ghosts"];

function generateTeamName() {
    const p = TEAM_PREFIXES[Math.floor(Math.random() * TEAM_PREFIXES.length)];
    const s = TEAM_SUFFIXES[Math.floor(Math.random() * TEAM_SUFFIXES.length)];
    return `${p} ${s}`;
}

// --- CUSTOM TOURNAMENT POOL ---
let customTeamPool = [];

function registerP1ToTourney() {
    // 1. Get current P1 inputs
    const p1Inputs = document.querySelectorAll('.p1-input');
    const tourneySize = parseInt(document.getElementById('tourneyTeamSize').value) || 5;
let roster = Array.from(p1Inputs).map(i => i.value.toLowerCase()).filter(v => v !== '');

// Validate size
if (roster.length === 0) return showCustomMessage("Error", "P1 Squad is empty!");
if (roster.length > tourneySize) {
    roster = roster.slice(0, tourneySize); // Trim if too many
} else if (roster.length < tourneySize) {
    // Fill with 'unarmed' if too few
    while(roster.length < tourneySize) roster.push('unarmed');
}

    if (roster.length === 0) return showCustomMessage("Error", "P1 Squad is empty!");
    if (customTeamPool.length >= 16) return showCustomMessage("Full", "Tournament Pool is full (16/16). Clear it to add more.");

    // 2. Ask for a Name
    let defaultName = "Custom Team " + (customTeamPool.length + 1);
    let name = prompt("Enter Team Name:", defaultName);
    if (!name) return; // Cancelled

    // 3. Save to Pool
    customTeamPool.push({
        id: 'custom_' + Math.random(),
        name: name.toUpperCase(),
        roster: roster,
        color: '#00c3ff', // Force P1 Blue or randomize
        wins: 0,
        isCustom: true // Flag to identify player teams
    });

    // 4. Update UI
    updatePoolUI();
    if(typeof playSound === 'function') playSound('zap');
}

function clearTourneyPool() {
    customTeamPool = [];
    updatePoolUI();
    showCustomMessage("Cleared", "Tournament Pool emptied.");
}

function updatePoolUI() {
    const counter = document.getElementById('poolCounter');
    if(counter) counter.innerText = `${customTeamPool.length}/16`;
}

function initTournament() {
    let newTeams = [];
    
    // 1. Add ALL Custom Teams first
    // We clone them so we don't mess up the original pool if we run multiple tourneys
    customTeamPool.forEach(t => {
        newTeams.push(JSON.parse(JSON.stringify(t)));
    });

    // 2. Fill the rest of the 16 slots with Random Bots
    const slotsRemaining = 16 - newTeams.length;
    
    for(let i=0; i < slotsRemaining; i++) {
         // Get the preferred size from the new UI setting
// Force the size to the exact integer from the UI
const preferredSize = parseInt(document.getElementById('tourneyTeamSize').value) || 5;
let roster = [];

// Generate exactly 'preferredSize' fighters
for(let j = 0; j < preferredSize; j++) {
    const randomFighter = FIGHTER_OPTIONS[Math.floor(Math.random() * FIGHTER_OPTIONS.length)];
    roster.push(randomFighter);
}
        newTeams.push({
            id: i,
            name: generateTeamName(),
            roster: roster,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            wins: 0,
            isCustom: false
        });
    }

    // 3. Shuffle the teams so custom ones aren't always in the first matches
    newTeams.sort(() => Math.random() - 0.5);

    // 4. Build Bracket Structure (Round 1)
    let round1 = [];
    for(let i=0; i<8; i++) {
        round1.push({
            p1: newTeams[i*2],
            p2: newTeams[i*2+1],
            winner: null
        });
    }

    tournamentData = {
        active: true,
        teams: newTeams,
        round: 0,
        matches: [round1], 
        currentMatchIndex: 0
    };

    document.getElementById('tourneyStatus').innerText = "Round 1: 16 Teams Ready";
    
    // Switch view
    isSetupPhase = true; 
    isTournamentMatch = false;
    if(typeof playSound === 'function') playSound('zap');
}

function playNextMatch(mode) {
    if(!tournamentData.active) return showCustomMessage("Error", "Start a new tournament first!");
    
    let currentRound = tournamentData.matches[tournamentData.round];
    
    // Find next unplayed match
    let matchIndex = currentRound.findIndex(m => m.winner === null);
    
    if (matchIndex === -1) {
        // Round Complete! Generate next round
        if (tournamentData.matches[tournamentData.round].length === 1) {
            // FINALS COMPLETE
            let champion = tournamentData.matches[tournamentData.round][0].winner;
            showCustomMessage("CHAMPION!", `${champion.name} wins the Tournament!`);
            return;
        }
        advanceRound();
        return;
    }

    let match = currentRound[matchIndex];
    tournamentData.currentMatchIndex = matchIndex;

    if (mode === 'sim') {
        // Quick Math Simulation
        // Calculate "Strength" = HP + Dmg potential roughly
        let score1 = 0; let score2 = 0;
        match.p1.roster.forEach(t => score1 += (FIGHTER_DATA[t]?.hp || 100));
        match.p2.roster.forEach(t => score2 += (FIGHTER_DATA[t]?.hp || 100));
        
        // Add randomness (+/- 30%)
        score1 *= (0.7 + Math.random() * 0.6);
        score2 *= (0.7 + Math.random() * 0.6);

        match.winner = score1 > score2 ? match.p1 : match.p2;
        showCustomMessage("Simulated", `${match.winner.name} wins!`);
        saveTournament(); // Auto-save logic
    } 
    else if (mode === 'watch') {
        // Load squads into game engine
        clearSquads();
        
        // Populate Team 1 (Left)
        // Note: We bypass the inputs and write directly to entities in a custom start function
        loadTournamentTeams(match.p1, match.p2);
    }
}

function loadTournamentTeams(team1, team2) {
    // Clear everything
    entities = []; obstacles = []; projectiles = [];
    isTournamentMatch = true;

    // Set Map Size (Optional: Randomize?)
    changeMapSize(); // Uses current dropdown selection

    // Spawn Team 1
    team1.roster.forEach((type, i) => {
        let f = createFighter(type, 100, 100 + i*40, 1, false, null, null, 'p1', i);
        let pos = getSafeSpawnPos(1);
        f.x = pos.x; f.y = pos.y;
        f.color = team1.color; // Use custom team color
        entities.push(f);
    });

    // Spawn Team 2
    team2.roster.forEach((type, i) => {
        let f = createFighter(type, 100, 100 + i*40, 2, false, null, null, 'p2', i);
        let pos = getSafeSpawnPos(2);
        f.x = pos.x; f.y = pos.y;
        f.color = team2.color;
        entities.push(f);
    });

    // Populate Environment (Standard Obstacles)
    randomizeObstacles();

        // Start!
    isSetupPhase = false;
    gameActive = true;
    updateLiveCounts();
    resultModal.style.display = 'none';
    playBGM('battle');
    
    // Override titles
    document.getElementById('mainTitle').innerHTML = `<span style="color:${team1.color}">${team1.name}</span> VS <span style="color:${team2.color}">${team2.name}</span>`;
}

function advanceRound() {
    let currentRound = tournamentData.matches[tournamentData.round];
    let nextRound = [];
    
    // Create pairings for next round (Winner of Match 0 vs Winner of Match 1)
    for(let i=0; i < currentRound.length; i+=2) {
        nextRound.push({
            p1: currentRound[i].winner,
            p2: currentRound[i+1].winner,
            winner: null
        });
    }
    
    tournamentData.round++;
    tournamentData.matches.push(nextRound);
    showCustomMessage("Round Complete", "Advancing to next bracket...");
    saveTournament();
}

function saveTournament() {
    if(!tournamentData.active) return;
    localStorage.setItem('ballBattle_tournament_save', JSON.stringify(tournamentData));
    showCustomMessage("Saved", "Tournament progress saved.");
}

function loadTournament() {
    let data = localStorage.getItem('ballBattle_tournament_save');
    if(data) {
        tournamentData = JSON.parse(data);
        showCustomMessage("Loaded", "Resumed previous tournament.");
        // Force mode switch to visualize
        document.getElementById('modeSelect').value = 'tournament';
        toggleGameMode();
    } else {
        showCustomMessage("Error", "No saved tournament found.");
    }
}

function exitTournament() {
    // 1. Force the dropdown back to 'team'
    document.getElementById('modeSelect').value = 'team';
    
    // 2. Trigger the normal toggle function to swap UI back
    toggleGameMode();
    
    // 3. Ensure we are in setup mode so the bracket stops drawing
    isSetupPhase = true;
    
    // 4. Force a redraw of the blank arena
    resetPositions();
}

let placementWeaponType = 'dagger';



        // --- OBSTACLE & PLACEMENT CONTROLS ---
        function randomizeObstacles() {
    // 1. Clear existing obstacles
    obstacles = [];
    
    // Clear existing neutral mines/turrets so we get a fresh board
    projectiles = projectiles.filter(p => !p.isMine || p.team !== 0);
    entities = entities.filter(e => e.type !== 'turret' || e.team !== 0);
    
    // 2. SCALE COUNT BASED ON MAP SIZE (NEW LOGIC)
    let min = 8, max = 13; // Default (Normal)

    if (canvas.width >= 2000) { 
        // Huge Map
        min = 50; max = 80; 
    } else if (canvas.width >= 1200) { 
        // Large Map
        min = 25; max = 40; 
    } else if (canvas.width <= 400) { 
        // Small Map
        min = 4; max = 7; 
    }

    const count = min + Math.floor(Math.random() * (max - min));
    
    // 3. Define Types (Add 'black_hole' here if you added that feature!)
    const types = ['rock', 'rock', 'barrel', 'barrel', 'lava', 'spike', 'ice', 'mine', 'mine' ];
    const padding = 60; 

    for (let i = 0; i < count; i++) {
        let safe = false;
        let attempts = 0;
        let x, y, type, radius;

        // Increased attempts to 200 to ensure we fit everything on crowded maps
        while (!safe && attempts < 200) {
            attempts++;
            x = padding + Math.random() * (canvas.width - padding * 2);
            y = padding + Math.random() * (canvas.height - padding * 2);
            type = types[Math.floor(Math.random() * types.length)];
            
            // Determine radius
            if (type === 'lava') radius = 40;
            else if (type === 'ice') radius = 45;
            else if (type === 'turret') radius = 15;
            else if (type === 'mine') radius = 10;
            else if (type === 'black_hole') radius = 30; // Check for your black hole
            else radius = 25; // Rock/Spike

            // Check collision with:
            // A. Standard Obstacles
            let overlap = false;
            for (let o of obstacles) {
                let dist = Math.sqrt((x - o.x)**2 + (y - o.y)**2);
                if (dist < radius + o.radius + 20) { overlap = true; break; }
            }
            
            // B. Existing Neutral Mines
            if (!overlap) {
                 for (let p of projectiles) {
                    if (p.isMine && p.team === 0) {
                         let dist = Math.sqrt((x - p.x)**2 + (y - p.y)**2);
                         if (dist < radius + p.radius + 20) { overlap = true; break; }
                    }
                 }
            }

            // C. Existing Neutral Turrets
            if (!overlap) {
                for (let e of entities) {
                    if (e.type === 'turret' && e.team === 0) {
                        let dist = Math.sqrt((x - e.x)**2 + (y - e.y)**2);
                        if (dist < radius + e.radius + 20) { overlap = true; break; }
                    }
                }
            }
            
            if (!overlap) safe = true;
        }

        // Only add if we found a safe spot
        if (safe) {
            if (type === 'mine') {
                projectiles.push({
                    x: x, y: y, vx: 0, vy: 0, radius: 10, team: 0,
                    ownerId: 'env', life: 999999, isMine: true, shooterId: 'env'
                });
            }
            else if (type === 'turret') {
                spawnTurret(x, y, 0, 'env');
            }
            else {
                // Standard Obstacles
                let obsProps = { radius: 25, mass: 1000, hp: 120, maxHp: 120 };
                if (type === 'lava') obsProps = { radius: 40, mass: 0, hp: 9999, maxHp: 9999 };
                if (type === 'spike') obsProps = { radius: 25, mass: 1000, hp: 200, maxHp: 200 };
                if (type === 'ice') obsProps = { radius: 45, mass: 0, hp: 9999, maxHp: 9999 };
                // Add Black Hole props here if you have them:
                if (type === 'black_hole') obsProps = { radius: 30, mass: 9999, hp: 9999, maxHp: 9999 };

                if (type === 'barrel') {
                    obsProps = { 
                        radius: 20, 
                        mass: 2.0, 
                        hp: 50, 
                        maxHp: 50, 
                        vx: 0, vy: 0,
                        friction: 0.92 
                    };}

                obstacles.push({ x: x, y: y, type: type, ...obsProps });
            }
        }
    }
    
    if (typeof playSound === 'function') playSound('clash');
}
        // --- DYNAMIC UI ---
        
        function toggleGameMode() {
    // Allow switching if in Setup Phase OR if coming back from a tourney match
    if (!isSetupPhase && !isTournamentMatch) {
        showCustomMessage('Notice', 'Cannot change game mode during battle. Hit RESET first.');
        document.getElementById('modeSelect').value = GAME_MODE; 
        return;
    }
    GAME_MODE = document.getElementById('modeSelect').value;
    
    const title = document.getElementById('mainTitle');
    const teamScore = document.getElementById('teamScoreDisplay');
    const ffaScore = document.getElementById('ffaScoreDisplay');
    
    // UI Switching
    const stdControls = document.getElementById('standardControls');
    const tourneyControls = document.getElementById('tournamentControls');
    const squadSection = document.querySelector('.squad-section');
    
    if (GAME_MODE === 'tournament') {
        stdControls.style.display = 'none';
        tourneyControls.style.display = 'flex';
        squadSection.style.display = 'none'; // Hide manual squad inputs
        title.innerHTML = '<span style="color:gold">TOURNAMENT BRACKET</span>';
        
        // Show bracket view logic will happen in draw()
        isSetupPhase = true;
    } else {
        stdControls.style.display = 'flex';
        tourneyControls.style.display = 'none';
        squadSection.style.display = 'flex';
        
        if (GAME_MODE === 'ffa') {
    title.innerHTML = '<span style="color:#ff4500">BATTLE ROYALE</span>';
    teamScore.style.display = 'none';
    ffaScore.style.display = 'inline';

    // FFA uses only one visible fighter count.
    const p2Count = document.getElementById('p2Count');
    const countVsLabel = document.getElementById('countVsLabel');

    if (p2Count) p2Count.style.display = 'none';
    if (countVsLabel) countVsLabel.style.display = 'none';
} else {
    title.innerHTML = '<span class="highlight-p1">Left</span> VS <span class="highlight-p2">Right</span>';
    teamScore.style.display = 'inline';
    ffaScore.style.display = 'none';

    const p2Count = document.getElementById('p2Count');
    const countVsLabel = document.getElementById('countVsLabel');

    if (p2Count) p2Count.style.display = '';
    if (countVsLabel) countVsLabel.style.display = '';
}

updateSquadUI();
initializeSquads();
updateWeaponDropdown();
        if (GAME_MODE === 'tournament') {
    // ... existing code ...
    
    // NEW: Sync manual squad counts to the tournament size setting
    const tSize = document.getElementById('tourneyTeamSize').value;
    document.getElementById('p1Count').value = tSize;
    document.getElementById('p2Count').value = tSize;
    updateSquadUI(); // Refresh the slots
}
    }
}

function updateWeaponDropdown() {
    const daggerOpt = document.querySelector("#weaponSelect option[value='dagger']");
    const gunOpt = document.querySelector("#weaponSelect option[value='gun']");
    const scytheOpt = document.querySelector("#weaponSelect option[value='scythe']");
    
    if (GAME_MODE === 'pet') {
        if(daggerOpt) daggerOpt.innerText = "Place: Apple";
        if(gunOpt) gunOpt.innerText = "Place: Meat";
        if(scytheOpt) scytheOpt.innerText = "Place: Candy";
    } else {
        if(daggerOpt) daggerOpt.innerText = "Place: Dagger";
        if(gunOpt) gunOpt.innerText = "Place: Gun";
        if(scytheOpt) scytheOpt.innerText = "Place: Scythe";
    }
}


// --- ARENA STATE ---
let ARENA_THEME = 'white';

function changeArenaTheme() {
    if (!isSetupPhase) {
        showCustomMessage('Notice', 'Cannot change arena during battle. Hit RESET first.');
        // Revert selection
        document.getElementById('arenaSelect').value = ARENA_THEME;
        return;
    }
    
    ARENA_THEME = document.getElementById('arenaSelect').value;
    
    // Optional: Play a sound to confirm
    if (typeof playSound === 'function') playSound('zap');
}
        // --- NEW: MAP SIZE LOGIC ---
function changeMapSize() {
    if (!isSetupPhase) {
        showCustomMessage('Notice', 'Cannot change map size during battle. Hit RESET first.');
        // Revert the dropdown to the current actual size
        const currentWidth = canvas.width;
        if (currentWidth === 400) document.getElementById('mapSizeSelect').value = 'small';
        else if (currentWidth === 600) document.getElementById('mapSizeSelect').value = 'normal';
        else if (currentWidth === 1200) document.getElementById('mapSizeSelect').value = 'large';
        else if (currentWidth === 2000) document.getElementById('mapSizeSelect').value = 'huge';
        return;
    }

    const size = document.getElementById('mapSizeSelect').value;
    
    // Define dimensions based on selection
    let w, h;
    if (size === 'small') { w = 400; h = 400; }        // Tight box
    else if (size === 'normal') { w = 600; h = 500; }  // Classic (Default)
    else if (size === 'large') { w = 1200; h = 800; }  // 2x size
    else if (size === 'huge') { w = 2000; h = 1500; }  // Massive

    // 1. Update Internal Resolution
    canvas.width = w;
    canvas.height = h;

    // 2. Update CSS Aspect Ratio to prevent stretching
    // We update the inline style to override the CSS file
    canvas.style.aspectRatio = `${w} / ${h}`;

    // 3. Reset Camera to center of new map
    camera.x = w / 2;
    camera.y = h / 2;
    
    // 4. Respawn/Re-center entities
    initializeSquads(); 
}

        

        function updateSquadUI() {
    // This function is called whenever the count changes or the page loads.
    // It regenerates the selection inputs AND reinitializes the entities array for setup.
    const c1 = parseInt(document.getElementById('p1Count').value) || 1;
    const c2 = GAME_MODE === 'ffa' ? 0 : (parseInt(document.getElementById('p2Count').value) || 1);
            
            // Adjust grid layout dynamically
            const grid1 = c1 > 1 ? 'repeat(2, 1fr)' : 'repeat(1, 1fr)';
            const grid2 = c2 > 1 ? 'repeat(2, 1fr)' : 'repeat(1, 1fr)';
            document.getElementById('p1SquadContainer').style.gridTemplateColumns = grid1;
            document.getElementById('p2SquadContainer').style.gridTemplateColumns = grid2;

            // Store current fighter types to reapply when recreating inputs
            const currentP1Types = Array.from(document.querySelectorAll('.p1-input')).map(input => input.value.toLowerCase());
            const currentP2Types = Array.from(document.querySelectorAll('.p2-input')).map(input => input.value.toLowerCase());

           const squadSection = document.getElementById('squadSection');
const p2SquadContainer = document.getElementById('p2SquadContainer');
const squadVsLabel = document.getElementById('squadVsLabel');

if (GAME_MODE === 'ffa') {
    if (squadSection) squadSection.classList.add('ffa-squad-mode');
    if (p2SquadContainer) p2SquadContainer.style.display = 'none';
    if (squadVsLabel) squadVsLabel.style.display = 'none';

    generateSelectors('p1SquadContainer', c1, 'p1', currentP1Types);
    generateSelectors('p2SquadContainer', 0, 'p2', []);
} else {
    if (squadSection) squadSection.classList.remove('ffa-squad-mode');
    if (p2SquadContainer) p2SquadContainer.style.display = '';
    if (squadVsLabel) squadVsLabel.style.display = '';

    generateSelectors('p1SquadContainer', c1, 'p1', currentP1Types);
    generateSelectors('p2SquadContainer', c2, 'p2', currentP2Types);
}
            
            // Re-initialize entities for setup phase
           if (isSetupPhase) {
    initializeSquads();
}
        }

        function generateSelectors(containerId, count, prefix, previousTypes) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const teamName = GAME_MODE === 'ffa' ? 'Free For All' : (prefix === 'p1' ? 'Left' : 'Right');

    const header = document.createElement('div');
    header.className = `squad-modern-header ${prefix === 'p1' ? 'left' : 'right'}`;
    header.innerHTML = `
        <div>
            <div class="squad-modern-title">${teamName} Squad</div>
            <div class="squad-modern-subtitle">${count} fighter${count === 1 ? '' : 's'}</div>
        </div>
        <button class="btn-duplicate-slot compact duplicate-last" type="button" title="Duplicate last fighter">Dup</button>
            <button class="btn-add-slot compact" type="button">Add</button>
    `;
    const duplicateLastBtn = header.querySelector('.duplicate-last');
    const addBtn = header.querySelector('.btn-add-slot');

    if (duplicateLastBtn) {
        duplicateLastBtn.onclick = function() {
            duplicateLastSlot(prefix);
        };
    }

    if (addBtn) {
        addBtn.onclick = function() {
            addSlot(prefix);
        };
    }
    container.appendChild(header);

    for (let i = 0; i < count; i++) {
        const initialValue = (previousTypes[i] || '').toLowerCase();
        const safeType = FIGHTER_OPTIONS.includes(initialValue) ? initialValue : '';
        const data = FIGHTER_DATA[safeType];

        const card = document.createElement('div');
        card.className = 'fighter-card';
        card.dataset.index = i;
        card.dataset.type = safeType || 'empty';

        card.innerHTML = `
            <div class="fighter-card-top">
                <div class="fighter-number-badge">${GAME_MODE === 'ffa' ? 'F' : (prefix === 'p1' ? 'L' : 'R')}${i + 1}</div>

                ${fighterPortraitHTML(safeType || 'unarmed')}

                <div class="fighter-card-main">
                    <div class="fighter-card-title">${safeType ? titleCaseName(safeType) : `Fighter ${i + 1}`}</div>
                    <div class="fighter-card-ability">${data ? data.ability : 'Choose a class'}</div>
                </div>

                <div class="fighter-card-actions">
                    <button class="btn-track modern-track" type="button" title="Track Camera">Cam</button>
                    <button class="btn-duplicate-slot modern-duplicate" type="button" title="Duplicate this fighter">Dup</button>
                    <button class="btn-remove-slot modern-remove" type="button" title="Remove Fighter">×</button>
                </div>
            </div>

           <div class="fighter-select-wrap">
    <input type="text" class="${prefix}-input fighter-dropdown-input modern-fighter-input" placeholder="Search fighter..." autocomplete="off" value="${safeType ? titleCaseName(safeType) : ''}">
    <button class="fighter-random-btn" type="button" title="Random fighter">?</button>
    <button class="fighter-clear-btn" type="button" title="Clear fighter">×</button>
    <div class="custom-dropdown-list"></div>
</div>

            <div class="fighter-card-stats">
                <span>HP <b>${data ? data.hp : '-'}</b></span>
                <span>DMG <b>${data ? data.dmg : '-'}</b></span>
            </div>

            <div class="fighter-card-desc">${data ? data.desc : 'Pick a fighter to see its role, stats, and battlefield behavior.'}</div>
        `;

        const input = card.querySelector('input');
const list = card.querySelector('.custom-dropdown-list');
const trackBtn = card.querySelector('.modern-track');
const duplicateBtn = card.querySelector('.modern-duplicate');
const removeBtn = card.querySelector('.modern-remove');
const clearTextBtn = card.querySelector('.fighter-clear-btn');
const randomTextBtn = card.querySelector('.fighter-random-btn');

randomTextBtn.onmousedown = function(e) {
    e.preventDefault();
    e.stopPropagation();

    const randomKey = FIGHTER_OPTIONS[Math.floor(Math.random() * FIGHTER_OPTIONS.length)];

    input.value = titleCaseName(randomKey);
    refreshCard(randomKey);
    renderStats(`${prefix}StatsContent`, randomKey);
    initializeSquads();

    list.style.display = 'none';

    if (typeof playSound === 'function') playSound('zap');
};

        trackBtn.id = `track-btn-${prefix}-${i}`;
        trackBtn.onclick = function(e) {
            e.preventDefault();
            trackFighter(i, prefix);
        };

        if (duplicateBtn) {
            duplicateBtn.onclick = function(e) {
                e.preventDefault();
                duplicateSlot(prefix, i);
            };
        }

        removeBtn.onclick = function(e) {
            e.preventDefault();
            removeSlot(prefix, i);
        };
        clearTextBtn.onmousedown = function(e) {
    e.preventDefault();
    e.stopPropagation();

    input.value = '';

    refreshCard('');
    initializeSquads();

    populateList('');
    list.style.display = 'block';

    setTimeout(() => {
        input.focus();
    }, 0);
};

        function refreshCard(type) {
            const validType = FIGHTER_OPTIONS.includes(type) ? type : '';
            const freshData = FIGHTER_DATA[validType];

            card.querySelector('.fighter-card-title').innerText = validType ? titleCaseName(validType) : `Fighter ${i + 1}`;
            card.querySelector('.fighter-card-ability').innerText = freshData ? freshData.ability : 'Choose a class';
            card.querySelector('.fighter-card-desc').innerText = freshData ? freshData.desc : 'Pick a fighter to see its role, stats, and battlefield behavior.';

            const stats = card.querySelector('.fighter-card-stats');
            stats.innerHTML = `
                <span>HP <b>${freshData ? freshData.hp : '-'}</b></span>
                <span>DMG <b>${freshData ? freshData.dmg : '-'}</b></span>
            `;

            const portraitHolder = card.querySelector('.fighter-portrait');
            if (portraitHolder) {
                portraitHolder.outerHTML = fighterPortraitHTML(validType || 'unarmed');
            }
        }

        function populateList(filterText = '') {
            list.innerHTML = '';
            const filter = filterText.toLowerCase();

            FIGHTER_OPTIONS.forEach(opt => {
                if (opt.includes(filter)) {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item modern-dropdown-item';

                    const optData = FIGHTER_DATA[opt];
                    item.innerHTML = `
    <div class="dropdown-portrait-box">
        ${fighterPortraitHTML(opt, 'tiny')}
    </div>
    <div class="dropdown-fighter-text">
        <strong>${titleCaseName(opt)}</strong>
        <small>${optData ? optData.ability : ''}</small>
    </div>
`;

                    item.onmousedown = function(e) {
                        e.preventDefault();
                        input.value = titleCaseName(opt);
                        list.style.display = 'none';
                        refreshCard(opt);
                        renderStats(`${prefix}StatsContent`, opt);
                        initializeSquads();
                        input.blur();
                    };

                    list.appendChild(item);
                }
            });
        }

        input.oninput = function() {
            const val = this.value.toLowerCase();

            if (FIGHTER_OPTIONS.includes(val)) {
                refreshCard(val);
                renderStats(`${prefix}StatsContent`, val);
                initializeSquads();
            } else if (val === '') {
                refreshCard('');
                initializeSquads();
            }

            populateList(val);
            list.style.display = 'block';
        };

        input.onfocus = function() {
            populateList(this.value);
            list.style.display = 'block';
        };

        input.onblur = function() {
            setTimeout(() => {
                list.style.display = 'none';
            }, 150);
        };

        container.appendChild(card);
    }
}

// --- NEW: Add/Remove Logic Helpers ---

function addSlot(prefix) {
    // 1. Find the counter input (p1Count or p2Count)
    const countInput = document.getElementById(prefix + 'Count');
    let currentVal = parseInt(countInput.value) || 0;

    // 2. Increment
    countInput.value = currentVal + 1;

    // 3. Trigger standard update
    updateSquadUI();
}

function normalizeFighterInputValue(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (FIGHTER_OPTIONS.includes(raw)) return raw;

    const normalized = raw.replace(/\s+/g, ' ');
    const match = FIGHTER_OPTIONS.find(opt => titleCaseName(opt).toLowerCase() === normalized);
    return match || '';
}

function getSquadInputValues(prefix) {
    return Array.from(document.querySelectorAll(`.${prefix}-input`))
        .map(input => normalizeFighterInputValue(input.value));
}

function duplicateSlot(prefix, index) {
    const currentTypes = getSquadInputValues(prefix);
    const sourceType = currentTypes[index] || 'unarmed';

    currentTypes.splice(index + 1, 0, sourceType);

    const countInput = document.getElementById(prefix + 'Count');
    countInput.value = currentTypes.length;

    const containerId = prefix === 'p1' ? 'p1SquadContainer' : 'p2SquadContainer';
    generateSelectors(containerId, currentTypes.length, prefix, currentTypes);

    initializeSquads();

    if (typeof playSound === 'function') playSound('equip');
}

function duplicateLastSlot(prefix) {
    const currentTypes = getSquadInputValues(prefix);
    const sourceType = currentTypes[currentTypes.length - 1] || 'unarmed';

    currentTypes.push(sourceType);

    const countInput = document.getElementById(prefix + 'Count');
    countInput.value = currentTypes.length;

    const containerId = prefix === 'p1' ? 'p1SquadContainer' : 'p2SquadContainer';
    generateSelectors(containerId, currentTypes.length, prefix, currentTypes);

    initializeSquads();

    if (typeof playSound === 'function') playSound('equip');
}

function removeSlot(prefix, index) {
    // 1. Get all current values for this side
    const inputs = document.querySelectorAll(`.${prefix}-input`);
    let currentTypes = Array.from(inputs).map(inp => normalizeFighterInputValue(inp.value));

    // 2. Remove the specific item from the array
    currentTypes.splice(index, 1);

    // 3. Update the Counter Input
    const countInput = document.getElementById(prefix + 'Count');
    countInput.value = currentTypes.length;

    // 4. Manually regenerate selectors with the modified array
    // We do this instead of updateSquadUI() because we need to force our specific modified array
    const containerId = prefix === 'p1' ? 'p1SquadContainer' : 'p2SquadContainer';
    generateSelectors(containerId, currentTypes.length, prefix, currentTypes.map(t => t.toLowerCase()));

    // 5. Update game state
    initializeSquads();
}

        function renderStats(elementId, type) {
    const data = FIGHTER_DATA[type];
    if (!data) return;

    const html = `
        <div class="fighter-preview-card">
            ${fighterPortraitHTML(type, 'large')}

            <div class="fighter-preview-title">${titleCaseName(type)}</div>
            <div class="fighter-preview-ability">${data.ability}</div>

            <div class="fighter-preview-grid">
                <div>
                    <span>Health</span>
                    <b>${data.hp}</b>
                </div>
                <div>
                    <span>Damage</span>
                    <b>${data.dmg}</b>
                </div>
            </div>

            <div class="fighter-preview-desc">${data.desc}</div>
        </div>
    `;

    document.getElementById(elementId).innerHTML = html;
}

        // --- GAME STATE ---
        let entities = [];
        let projectiles = [];
        let particles = [];
        let decals = [];
        let portals = [];
        let delayedDamageEvents = []; // For Samurai
        let damageText = []; // NEW: Array to store floating numbers
        let traps = []; // NEW: Array for Bear Traps
        let muzzleFlashes = [];
        let animationId;
        let gameActive = false; 
        let battleStats = {}; // Stores kills and names by ID
        let gameOverTriggered = false; 
        let hitStopTimer = 0; 
        
        // Physics
        const GRAVITY = 0.02; 
        const FRICTION = 0.98; 
        const WALL_BOUNCE = 0.8;

        // --- FACTORY ---
        function getInitialFacingAngle(team, spawnSide = null) {
    // In team modes:
    // P1 / Left side faces right.
    // P2 / Right side faces left.
    if (GAME_MODE !== 'ffa') {
        if (spawnSide === 'p1' || team === 1) return 0;
        if (spawnSide === 'p2' || team === 2) return Math.PI;
    }

    // In FFA, no fixed enemy side exists, so random facing is fairer.
    return Math.random() * Math.PI * 2;
}
        function createFighter(type, x, y, team, isDupe = false, parentId = null, hpOverride = null, spawnSide = null, spawnIndex = null) {
            // FIX: Allow internal types ('turret') to pass validation, otherwise default to 'unarmed'.
           const INTERNAL_TYPES = ['turret', 'boid', 'binder', 'skeleton', 'mammoth_mount'];

            if (!INTERNAL_TYPES.includes(type) && (!FIGHTER_OPTIONS.includes(type) || type === 'empty')) {
                type = 'unarmed';
            }

            let color = team === 1 ? '#00c3ff' : '#d62626';
            
            // FFA Color Override
            if (GAME_MODE === 'ffa' && type !== 'turret' && type !== 'boid' && !isDupe) {
                // Generate a consistent random color based on team ID (which is essentially index + 1 in FFA)
                // Use HSL for vibrant colors
                const hue = (team * 137.508) % 360; // Golden angle approx for distribution
                color = `hsl(${hue}, 70%, 50%)`;
            } else if (GAME_MODE === 'ffa' && (type === 'turret' || isDupe || type === 'boid')) {
                // Minions inherit parent color if possible, handled in spawn logic or defaulted here
                if (parentId) {
                    const parent = entities.find(e => e.id === parentId);
                    if (parent) color = parent.color;
                }
            }

            let baseHp = 100;

           if (type === 'turret') {
        baseHp = 60; 
    } else if (type === 'boid') {
        baseHp = 15;
    } else if (type === 'binder') {
        baseHp = 60; // <--- FIX: Give the pet explicit HP so it doesn't crash
    } else if (type === 'skeleton') {
        baseHp = 40; // <--- FIX: Ensure skeletons don't crash either
    } else if (type === 'mammoth_mount') {
        baseHp = 190;
    } else {
        baseHp = FIGHTER_DATA[type] ? FIGHTER_DATA[type].hp : 100; // Safety fallback
    }

            let finalHp;
            if (hpOverride !== null) {
                finalHp = hpOverride;
            } else {
                finalHp = baseHp * GLOBAL_HP_MULT;
            }

            let fighter = {
                id: Math.random(),
                type: type,
                originalType: type, 
                realType: type,
                team: team,
                dmgMult: 1.0,
                x: x, y: y,
                

                spawnSide: spawnSide,   // 'p1' or 'p2'
        spawnIndex: spawnIndex, // 0, 1, 2...

        


                // NEW: Store initial spawn position
                vx: type === 'turret' ? 0 : (Math.random() - 0.5) * 10, 
        vy: type === 'turret' ? 0 : (Math.random() - 0.5) * 10,
        radius: type === 'turret' ? 15 : (type === 'boid' ? 6 : 20),
        hp: finalHp,
        maxHp: finalHp,
        color: color,
        mass: 1,

        stuckArrows: [],
                
                // AI Vars
                angle: getInitialFacingAngle(team, spawnSide), target: null, timer: 0, dupeTimer: 0,
                state: (type === 'soldier' || type === 'dualist') ? 'ready' : 'idle', // Soldier/dualist state, // Soldier state
                flashTime: 0, teleportCooldown: 0, portalTimer: 0, frozen: 0, 
                bravery: Math.random(), // 0.0 to 1.0. High = Aggressive. Low = Tactical/Cowardly
                isOriginal: !isDupe, parentId: parentId, reach: 0, ownerId: parentId,
                
                // New: Kill Tracking
                lastAttackerId: null,
                isKilledByMine: false, // Flag to identify mine kills (Trapper fix)
                lastPushedBy: null, // NEW: For wall slam tracking
                pushTimer: 0, // NEW: Grace period for wall slam detection

                // General Status Effects
                paranoiaTimer: 0, isParanoid: false,
                danceTimer: 0, isDancing: false,

                // Clash System
                clashTimer: 0,
                 clashCooldown: 0,
                
                // NEW: Burn Status
                burnTimer: 0, burnSourceId: null,

                spinTimer: 0, spinCooldown: 0, 
                fireTimer: 0, reloadTimer: 0, isReloading: false, 
                zapTimer: 0, zapCooldown: 0, isZapping: false, zapCharge: 0,
                cannonTimer: 200, ramTimer: 0, ramCooldown: 0, isRamming: false, isFrenzied: false,
                heldTargets: [], grabCooldown: 0, dropThreshold: 15, 
                stealthTimer: 0, stealthCooldown: 0, isStealthed: false,
                mimicTimer: 0, isScanning: false, morphTimer: 0,
                dampenTimer: 0, isDampening: false, dampenDuration: 0,
                whisperTimer: 0, isControlling: false,
                
                // Bow Special
                flameCooldown: 0,

                // Alchemist
                potionTimer: 0, potionCycle: 0,
                // Poison Status
                poisonTimer: 0,
                // Chrono
                rewindTimer: 0, history: [],
                // Samurai
                dashCooldown: 0, dashCharge: 0,

                // Adapto Vars
                adaptTimer: 0, 
                flashbangCooldown: 0,
                currentMode: 'sword', // Modes: sword, gun, shield
                                
                // Unarmed Block & AI
                blockTimer: 0, 
                blockCooldown: 0, 
                isBlocking: false,
                chargeCooldown: 0, // NEW for Unarmed
                chargeTimer: 0, // NEW for Unarmed
                tacticalState: 'neutral', // NEW: neutral, positioning, charging, defending
                targetHazard: null, // NEW: Vector to hazard

                // Engineer
                turretTimer: 0, turretMax: 6,
                // Vampire
                isBat: false, batTimer: 0, batCooldown: 0,
                // Bard
                bardParanoiaCooldown: 60, // Slight start delay
                bardDanceCooldown: 200,    // Offset start delay
                
                // Trapper
                trapCooldown: 0,
                mineCooldown: 0,
                maxTraps: 3,
                trappedBy: null, // ID of the trap owner, if trapped

                // Aquamarine
                fishCooldown: 0,
                waterCooldown: 0,
                waterSprayTimer: 0,

                // Mammoth
                mammothId: null,
                mammothSpawnCooldown: 0,
                mammothStompCooldown: 0,

                // Spatial
                portalCooldown: 0,
                
                // Grabber Hook Vars
                hookCooldown: 0,
                grappledBy: null,

                // Spatial Slam Vars (MODIFIED: Array for multi-target)
                slamTargets: [], 
                slamTimer: 0,

                // --- NEW: CLAN MODE STATS ---
                rageStacks: 0,       // Counts how many teammates died
                prideStacks: 0,      // Counts how many enemies this team killed
                rageTargetId: null,  // ID of the killer to hunt down

                hunger: 50, // 0 = Starving, 100 = Full
                fun: 50,    // 0 = Bored, 100 = Happy
                isSleeping: false,
                petTimer: 0,

            };

            // --- STATS OVERRIDE LOGIC ---
if (spawnSide && spawnIndex !== null) {
    const key = `${spawnSide}_${spawnIndex}`;
    if (fighterOverrides[key]) {
        // Apply saved multipliers
        fighter.maxHp *= fighterOverrides[key].hpMult;
        fighter.hp = fighter.maxHp;
        fighter.dmgMult = fighterOverrides[key].dmgMult;
        
        // Visual indicator that this unit is edited
        fighter.isEdited = true; 
    } else {
        fighter.dmgMult = 1.0; // Default if no override
    }
} else {
    fighter.dmgMult = 1.0; // Default for things like summons
}

            applyClassProps(fighter, type);
            if (type === 'chameleon') fighter.isScanning = true;
            return fighter;
        }
        
        function createTrap(x, y, team, ownerId) {
            return {
                x: x, y: y,
                radius: 15,
                team: team,
                ownerId: ownerId,
                trappedEnemyId: null,
                duration: 0, // Frames left to root
                life: 900, // Lifespan of a trap (15 seconds if not sprung)
            };
        }
        
        function createMine(x, y, team, ownerId) {
            return {
                x: x, y: y,
                vx: 0, vy: 0, // Mines are stationary
                radius: 10,
                team: team,
                ownerId: ownerId,
                life: 300, // 5 seconds fuse
                isMine: true,
                shooterId: ownerId,
                spawnedByFighter: ownerId !== 'env' && team !== 0,
            };
        }

        function applyClassProps(fighter, type) {
            switch(type) {
                case 'fight knight':
                    fighter.mass = 2.5; 
                    fighter.reach = 75; 
                    fighter.resurrectionStage = 0; // 0=Full, 1=Cracked, 2=Ripped, 3=Gone, 4=Final
                    fighter.maxHp = 140; // Start huge
                    fighter.hp = 140;
                    break;
                case 'lance': fighter.reach = 80; fighter.mass = 1.2; break;
                case 'aquamarine':
                    fighter.mass = 1.05;
                    fighter.reach = 260;
                    fighter.fishCooldown = 45;
                    fighter.waterCooldown = 20;
                    fighter.waterSprayTimer = 0;
                    break;
                case 'scythe': fighter.reach = 70; fighter.swingSpeed = 0.15; fighter.swingDir = 1; break;
                case 'grower': fighter.mass = 1.2; fighter.radius = 15; fighter.growthRate = 0.1; fighter.maxRadius = 350; 
                fighter.blockTimer = 0; fighter.blockCooldown = 0; fighter.isBlocking = false; 
                break;
                case 'duplicator': 
                fighter.generation = 1; 
                // ENABLE BLOCKING STATS
                fighter.blockTimer = 0; 
                fighter.blockCooldown = 0; 
                fighter.isBlocking = false;
                break;
                case 'bow': fighter.fireRate = 45; fighter.reach = 400; break; 
                case 'laser':
    fighter.chargeTime = 100;
    fighter.fireTime = 30;
    fighter.laserMode = 'short';
    fighter.mass = 1.15;
    fighter.blockTimer = 0;
    fighter.blockCooldown = 0;
    fighter.isBlocking = false;
    break;
                case 'knight': fighter.reach = 60; fighter.shieldAngle = 0; fighter.mass = 1.5; break;
                case 'orbiter': fighter.orbCount = 6; fighter.orbAngle = 0; break;
                case 'spearer':
                    fighter.mass = 1.15;
                    fighter.reach = 620;
                    fighter.spearCooldown = 35;
                    fighter.explosiveSpearCooldown = 150;
                    fighter.bounceSpearCooldown = 100;
                    break;
                case 'soldier': 
                case 'dualist': // Add this line
                    fighter.mass = 1.3; 
                    fighter.reach = 10000; 
                    break;
                case 'pirate': fighter.reach = 50; fighter.mass = 1.4; break;
                case 'mammoth':
                    fighter.mass = 1.7;
                    fighter.radius = 18;
                    fighter.reach = 65;
                    fighter.mammothSpawnCooldown = 0;
                    fighter.mammothStompCooldown = 0;
                    break;
                case 'grabber': fighter.mass = 1.6; break;
                case 'regenerator': fighter.mass = 2.0; fighter.bravery = 1.0; fighter.blockTimer = 0; fighter.blockCooldown = 0; fighter.isBlocking = false; break;
                case 'unarmed': fighter.mass = 2.0; fighter.blockTimer = 0; fighter.blockCooldown = 0; fighter.isBlocking = false; break;
                case 'rogue': fighter.mass = 1.0; break;
                case 'chameleon': 
                    // Acts as Unarmed (Heavy mass + Block stats)
                    fighter.mass = 2.0; 
                    fighter.blockTimer = 0; 
                    fighter.blockCooldown = 0; 
                    fighter.isBlocking = false;
                    break;
                case 'devourer': fighter.mass = 2.2; break;
                case 'whispers': fighter.mass = 1.0; break;
               case 'alchemist': fighter.mass = 1.1; fighter.moveSpeed = 0.45; break; // Optional speed buff?
                case 'chrono': 
                    fighter.mass = 2.0; // Heavy mass like Unarmed
                    fighter.blockTimer = 0; 
                    fighter.blockCooldown = 0; 
                    fighter.isBlocking = false;
                    break;
                case 'samurai':
    fighter.mass = 1.2;
    fighter.reach = 58;
    break;
                case 'engineer': fighter.mass = 1.0; break;
                case 'turret': 
                    fighter.mass = 100; // Heavy/Fixed
                    fighter.vx = 0;
                    fighter.vy = 0;
                    break; 
                case 'vampire': fighter.mass = 1.0; break;
                case 'bard': fighter.reach = 60; fighter.mass = 1.1; break; // Guitar sword
                case 'trapper':
                    fighter.mass = 0.9;
                    fighter.reach = 30; // Dagger range
                    fighter.trapCooldown = 120; // 2s CD
                    fighter.mineCooldown = 300; // 5s CD
                    break;
                case 'spatial': fighter.mass = 1.1; fighter.portalCooldown = 0; break; // Added portalCooldown
                case 'boid': 
                    fighter.mass = 0.4;
                    fighter.radius = 6;
                    break;
                case 'adapto': fighter.mass = 1.2; fighter.reach = 45; break;
                case 'necromancer': 
            fighter.mass = 1.1; 
            fighter.moveSpeed = 0.4; // Kiting speed
            fighter.blightCooldown = 0; 
            fighter.isBlighting = false; 
            break;
        case 'skeleton': 
            fighter.mass = 0.8; 
            fighter.radius = 15; // Smaller than normal
            fighter.hp = 40; // Fragile
            fighter.maxHp = 40;
            fighter.bravery = 1.0; // Fearless melee
            break;
        case 'mammoth_mount':
            fighter.mass = 5.5;
            fighter.radius = 34;
            fighter.reach = 70;
            fighter.hp = Math.max(fighter.hp || 0, 190);
            fighter.maxHp = Math.max(fighter.maxHp || 0, 190);
            fighter.bravery = 1.0;
            break;
            case 'binder':
    fighter.radius = 12;      // Small
    fighter.mass = 0.8;       // Light
    fighter.hp = 60;          // Decent health
    fighter.maxHp = 60;
    fighter.bindTimer = 0;    // Duration of the bite
    fighter.bindCooldown = 0; // Time between bites
    fighter.boundTargetId = null;
    break;
            }
        }

        function spawnTurret(x, y, team, ownerId) {
             // Ensure turret is created as a non-original entity with the owner ID
             const p = clampArenaPoint(x, y, 20);
             let turret = createFighter('turret', p.x, p.y, team, true, ownerId);
             turret.spawnedByFighter = ownerId !== 'env';
             entities.push(turret);
             spawnParticles(p.x, p.y, '#444', 8);
             playSound('clash');
        }


       function getSafeSpawnPos(side, myRadius = 20) {
            const padding = 50; 
            let pos = { x: 0, y: 0 };
            let safe = false;
            let attempts = 0;
        
            // Try harder (300 attempts) to find a spot
            while (!safe && attempts < 300) {
                attempts++;
                
                if (GAME_MODE === 'ffa') {
                    // FFA: Pick ANY random spot on the canvas
                    pos.x = padding + Math.random() * (canvas.width - padding * 2);
                    pos.y = padding + Math.random() * (canvas.height - padding * 2);
                } else {
                    // TEAM: Split map left/right
                    if (side === 1) { // Left Side (P1)
                        pos.x = padding + Math.random() * 200; 
                        pos.y = padding + Math.random() * (canvas.height - padding * 2);
                    } else { // Right Side (P2)
                        pos.x = canvas.width - padding - Math.random() * 200;
                        pos.y = padding + Math.random() * (canvas.height - padding * 2);
                    }
                }
        
                safe = true;
        
                // 1. Check against OBSTACLES
                for (let o of obstacles) {
                    let dist = Math.sqrt((pos.x - o.x)**2 + (pos.y - o.y)**2);
                    // Standard radius check + buffer
                    if (dist < o.radius + myRadius + 15) { 
                        safe = false;
                        break; 
                    }
                }
        
                // 2. Check against OTHER FIGHTERS
                if (safe) {
                    for (let e of entities) {
                        let dist = Math.sqrt((pos.x - e.x)**2 + (pos.y - e.y)**2);
                        // Ensure we don't spawn inside another unit
                        if (dist < e.radius + myRadius + 15) { 
                            safe = false;
                            break;
                        }
                    }
                }

                // 3. Check against WEAPONS (Pickups) - New!
                if (safe) {
                    for (let p of pickups) {
                        let dist = Math.sqrt((pos.x - p.x)**2 + (pos.y - p.y)**2);
                        if (dist < p.radius + myRadius + 10) { 
                            safe = false;
                            break;
                        }
                    }
                }
            }
            
            // Fallback: If map is totally full, just stack them at the edge so the game doesn't crash
            if (!safe) {
                pos.x = side === 1 ? 40 : canvas.width - 40;
                pos.y = 40 + (entities.length * 5) % (canvas.height - 80);
            }
            
            return pos;
        }
        // --- CONTROLS ---

        function initializeSquads() {

            // --- CHESS MODE INTERCEPTION ---
    if (GAME_MODE === 'chess') {
        entities = [];
        projectiles = [];
        particles = [];
        // Clear old stuff
        battleStats = {};
        isSetupPhase = true;
        
        // Helper to spawn a chess piece
        const spawnPiece = (type, row, col, team) => {
            const padding = 60;
            const cellSize = 50; // Distance between pieces
            
            // Calculate Position (Left Side vs Right Side)
            let x, y;
            if (team === 1) {
                x = padding + (col * cellSize); 
                y = padding + (row * cellSize) + (canvas.height/2 - 200); // Center vertically
            } else {
                x = canvas.width - padding - (col * cellSize);
                y = padding + (row * cellSize) + (canvas.height/2 - 200);
            }

            let f = createFighter(type, x, y, team);
            
            // KING LOGIC (Duplicator)
            if (type === 'duplicator') {
                f.isKing = true; // Mark as VIP
                f.maxHp *= 1.5;  // Buff King HP
                f.hp = f.maxHp;
                f.color = 'gold'; // Visual distinction
            }
            
            // KNIGHT LOGIC (Knight)
            if (type === 'knight') f.bravery = 1.0; // Knights are aggressive

            // PAWN LOGIC (Unarmed/Rogue)
            if (type === 'unarmed') f.mass *= 0.8; 

            entities.push(f);
        };

        // --- SPAWN TEAMS (Standard Chess Layout) ---
        // Rows: 0-7. Cols: 0 (Back), 1 (Front/Pawns)
        for (let team = 1; team <= 2; team++) {
            // Front Row: 8 Pawns
            for (let i = 0; i < 8; i++) {
                spawnPiece('unarmed', i, 1, team);
            }

            // Back Row: Pieces
            // 0:Rook, 1:Knight, 2:Bishop, 3:Queen, 4:King, 5:Bishop, 6:Knight, 7:Rook
            spawnPiece('laser',   0, 0, team); // Rook (Laser/Tower)
            spawnPiece('knight',  1, 0, team); // Knight
            spawnPiece('wizard',  2, 0, team); // Bishop
            
            // King/Queen positions swap based on color in real chess, 
            // but here we just keep King protected.
            spawnPiece('spatial', 3, 0, team); // Queen (Spatial = Moves anywhere)
            spawnPiece('duplicator', 4, 0, team); // King (Duplicator)
            
            spawnPiece('wizard',  5, 0, team); // Bishop
            spawnPiece('knight',  6, 0, team); // Knight
            spawnPiece('laser',   7, 0, team); // Rook
        }

        updateLiveCounts();
        if (!gameActive) { gameActive = true; loop(); }
        return; // STOP HERE so we don't run the normal squad logic
    }
            // Temporary storage for preserving custom positions
            const preservedPositions = new Map();
            
            // Only preserve positions if we are RE-initializing existing, non-turret entities 
            // that were present before this call.
            if (entities.length > 0) {
                entities.filter(e => e.type !== 'turret' && e.realType !== 'boid').forEach(e => {
                    // Use initialX/Y if present, otherwise use current position
                    const currentInitialX = e.initialX !== undefined ? e.initialX : e.x;
                    const currentInitialY = e.initialY !== undefined ? e.initialY : e.y;
                    
                    const key = e.team + '_' + e.originalType + '_' + e.id; 
                    preservedPositions.set(key, { x: e.x, y: e.y, initialX: currentInitialX, initialY: currentInitialY });
                });
            }

            // 1. SAVE NEUTRALS (Team 0)
    // We filter specifically for items that belong to the environment (team 0)
    const savedMines = projectiles.filter(p => p.isMine && p.team === 0);
    const savedTurrets = entities.filter(e => e.type === 'turret' && e.team === 0);

    // 2. RESET GAME STATE
    entities = []; 
    projectiles = []; 
    particles = []; 
    portals = []; 
    delayedDamageEvents = [];
    traps = [];
    damageText = []; // Clear floating numbers
    hitStopTimer = 0; 
    frameCount = 0;
    gameOverTriggered = false;

    // 3. RESTORE NEUTRALS
    entities.push(...savedTurrets);
    projectiles.push(...savedMines);
            
            // 2. Set to Setup Phase
            isSetupPhase = true;
            
            // 3. Apply HP Multipliers for correct maxHp calculation
            const lengthMode = document.getElementById('lengthSelect').value;
            if (lengthMode === 'quick') { GLOBAL_HP_MULT = 0.6; GLOBAL_DMG_MULT = 1.5; } 
            else if (lengthMode === 'long') { GLOBAL_HP_MULT = 2.0; GLOBAL_DMG_MULT = 0.7; } 
            else { GLOBAL_HP_MULT = 1.0; GLOBAL_DMG_MULT = 1.0; }

            // 4. Retrieve fighter types
            const p1Selects = document.querySelectorAll('.p1-input'); 
            const p2Selects = document.querySelectorAll('.p2-input'); 
            
            let ffaTeamCounter = 1;
            let globalFighterCounter = 1;
            generatedBallNames = loadGeneratedBallNames();

            // 5. Create P1 Fighters (Left Side)
            p1Selects.forEach((inp, i) => { 
                let type = inp.value.toLowerCase(); 
                // Default team 1 unless FFA
                let team = GAME_MODE === 'ffa' ? ffaTeamCounter++ : 1;

                let key = '1_' + type + '_' + i; // Unique key for original spawn index
                
                // Calculate default initial position (Safe & Scattered)
                let spawn = getSafeSpawnPos(1, 25); // 1 = Left Side preference
                let defaultX = spawn.x;
                let defaultY = spawn.y;
                
                // Check if a previous position was saved for this slot/type combination
                const oldPos = preservedPositions.get(key);
                const x = oldPos ? oldPos.x : defaultX;
                const y = oldPos ? oldPos.y : defaultY;
                const initialX = oldPos ? oldPos.initialX : x;
                const initialY = oldPos ? oldPos.initialY : y;


                if (type === 'swarm') {
                    // Spawn 20 Boids
                    for(let b=0; b<20; b++) {
                        let bx = x + (Math.random()-0.5)*60;
                        let by = y + (Math.random()-0.5)*60;
                        let f = createFighter('boid', bx, by, team);
                        f.originalType = 'swarm'; // Tag as belonging to the swarm
                        f.initialX = bx; f.initialY = by;
                        entities.push(f);
                    }
                } else {
                    // Ensure initialX/Y are set to the *current* position for resetPositions() to work later
                    let f = createFighter(type, x, y, team, false, null, null, 'p1', i);
        f.initialX = initialX; 
        f.initialY = initialY;
        f.nameIndex = globalFighterCounter++;
f.displayName = getPersistentBallName('p1', i, type);
        if (f) entities.push(f);
        if (type === 'necromancer') {
                            spawnSkeleton(x - 30, y + 20, team, f.id);
                            spawnSkeleton(x - 30, y - 20, team, f.id);
                        }
         if (type === 'dualist') {
                    // Spawn the Binding Pet
                    let pet = createFighter('binder', x - 40, y, team, true, f.id);
                    pet.ownerId = f.id; // Link to Dualist
                    entities.push(pet);
                }               
                }
            });

            // 6. Create P2 Fighters (Right Side)
            p2Selects.forEach((inp, i) => { 
                let type = inp.value.toLowerCase(); 
                // Default team 2 unless FFA
                let team = GAME_MODE === 'ffa' ? ffaTeamCounter++ : 2;

                let key = '2_' + type + '_' + i;
                
                // Calculate default initial position (Safe & Scattered)
                let spawn = getSafeSpawnPos(2, 25); // 2 = Right Side preference
                let defaultX = spawn.x;
                let defaultY = spawn.y;
                
                const oldPos = preservedPositions.get(key);
                const x = oldPos ? oldPos.x : defaultX;
                const y = oldPos ? oldPos.y : defaultY;
                const initialX = oldPos ? oldPos.initialX : x;
                const initialY = oldPos ? oldPos.initialY : y;
                
                if (type === 'swarm') {
                    // Spawn 20 Boids
                    for(let b=0; b<20; b++) {
                        let bx = x + (Math.random()-0.5)*60;
                        let by = y + (Math.random()-0.5)*60;
                        let f = createFighter('boid', bx, by, team);
                        f.originalType = 'swarm';
                        f.initialX = bx; f.initialY = by;
                        entities.push(f);
                    }
                } else {
                   let f = createFighter(type, x, y, team, false, null, null, 'p2', i);
        f.initialX = initialX; 
        f.initialY = initialY;
        f.nameIndex = globalFighterCounter++;
f.displayName = getPersistentBallName('p2', i, type);
        if (f) entities.push(f);
        if (type === 'necromancer') {
                            spawnSkeleton(x + 30, y + 20, team, f.id);
                            spawnSkeleton(x + 30, y - 20, team, f.id);
                        }
                        if (type === 'dualist') {
    // Spawn the Binding Pet
    let pet = createFighter('binder', x + 40, y, team, true, f.id);
    pet.ownerId = f.id; // Link to Dualist
    entities.push(pet);
}
    }
            });

            // 4. RESET & REGISTER STATS
    battleStats = {}; // Clear old stats
    entities.forEach(e => {
        // We store the name now so we remember it even if they die later
        if (e.type !== 'turret' && e.type !== 'boid') {
           battleStats[e.id] = {
    name: getEntityName(e),
    type: e.type,
    color: e.color || '#777',
    kills: 0,
    team: e.team,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    spawnFrame: frameCount,
    deathFrame: null
};
        }
    });

            // Set initial live counts (excluding turrets that might be present later)
            updateLiveCounts();

            // Start the draw loop if not active
            if (!gameActive) {
                gameActive = true;
                loop();
            }
        }
        
        function updateLiveCounts() {
            if (GAME_MODE === 'ffa') {
                let alive = entities.filter(e => e.type !== 'turret' && e.type !== 'boid').length;
                // If only boids exist, count groups? Complex. Just count non-turrets.
                if (alive === 0 && entities.some(e => e.type === 'boid')) alive = 1; // Simplify boid swarm as 1 unit visually
                
                document.getElementById('liveCountFFA').innerText = alive;
            } else {
                let p1Alive = entities.filter(e => e.team === 1 && e.type !== 'turret').length;
                let p2Alive = entities.filter(e => e.team === 2 && e.type !== 'turret').length;
                document.getElementById('liveCountP1').innerText = p1Alive;
                document.getElementById('liveCountP2').innerText = p2Alive;
            }
        }
        
        function beginBattle() {
            // Check if any fighter is selected
            const hasFighters = entities.filter(e => e.type !== 'turret').length > 0;

            if (!hasFighters) {
                showCustomMessage('Error', 'Please select at least one valid fighter before starting the battle.');
                return;
            }

            // Start the actual fight
            isSetupPhase = false;
            gameOverTriggered = false;
            resultModal.style.display = 'none';

            // Every battle gets a new chaos run.
// Same matchup, different execution.
battleRunId++;
battleStartFrame = frameCount;
battleTotalKills = 0;

entities.forEach(e => {
    applyBattleChaosToFighter(e);

    const stat = ensureBattleStat(e);
    if (stat) {
        stat.kills = 0;
        stat.damageDealt = 0;
        stat.damageTaken = 0;
        stat.shotsFired = 0;
        stat.shotsHit = 0;
        stat.spawnFrame = frameCount;
        stat.deathFrame = null;
    }
});

                        playBGM('battle');
            if (typeof updateFullscreenHud === 'function') updateFullscreenHud();
        }

        // NEW: Function to handle 'Play Again'
        function playAgain() {

            clearFighterSpawnedHazards();

            // --- NEW: Clear Visuals ---
            decals = [];       // Removes blood
            particles = [];    // Removes explosions/dust
            damageText = [];   // Removes floating numbers
            // 1. Reinitialize (resurrects everyone and sets up their last known positions)
            initializeSquads(); 
            // 2. Start the battle immediately
           resetCamera();
            beginBattle();
        }

        function resetPositions() {
            // This rebuilds the entities list based on current selection, restoring HP and initial drag positions.
            initializeSquads(); 
            
            // Clear runtime elements
            clearFighterSpawnedHazards();
            particles = [];
            decals = [];
            portals = [];
            muzzleFlashes = [];
            obstacles = obstacles.filter(o => o.type !== 'wall_trap' && !o.tactical && !o.spawnedByFighter);
            delayedDamageEvents = [];
            damageText = []; // NEW: Clear text on reset
            resetCamera();
            isSetupPhase = true;
            gameOverTriggered = false;
            document.getElementById('killFeed').innerHTML = '';
            updateLiveCounts();
                        resultModal.style.display = 'none';
                        if (modalTimeout) {
    clearTimeout(modalTimeout);
    modalTimeout = null;
}
            playBGM('menu');
            if (typeof updateFullscreenHud === 'function') updateFullscreenHud();
        }
        
        function clearSquads() {
            fighterOverrides = {};
                clearGeneratedBallNames();
            // FIX 2: Only clear character input values, keeping the squad size (#L vs #R) intact.

            // 1. Clear character input values
            document.querySelectorAll('.p1-input, .p2-input').forEach(input => {
                input.value = '';
            });
            
            // 2. Clear stats display (since inputs are now empty)
            document.getElementById('p1StatsContent').innerHTML = '<div style="text-align:center; font-style:italic;">Select a fighter.</div>';
            document.getElementById('p2StatsContent').innerHTML = '<div style="text-align:center; font-style:italic;">Select a fighter.</div>';
            
            // 3. Re-initialize the game state. This will rebuild the entities list using empty input fields,
            // effectively clearing the arena while keeping the input *structure* based on counts.
            initializeSquads(); 

            // Reset game flags/info
            gameOverTriggered = false;
            document.getElementById('killFeed').innerHTML = '';
            
            // Ensure the focus remains on the setup phase
            isSetupPhase = true; 
        }

        // --- UPDATED RANDOMIZATION LOGIC ---

function randomizeSquads(target = 'all') {
    // 1. Determine which inputs to select based on the button clicked
    let selector = '';
    if (target === 'p1') {
        selector = '.p1-input'; // Only Left Team
    } else if (target === 'p2') {
        selector = '.p2-input'; // Only Right Team
    } else {
        selector = '.p1-input, .p2-input'; // Everyone
    }

    const inputs = document.querySelectorAll(selector);

    // 2. Loop through selected inputs and assign random fighters
    inputs.forEach(input => {
        const randomKey = FIGHTER_OPTIONS[Math.floor(Math.random() * FIGHTER_OPTIONS.length)];
        const displayValue = randomKey.charAt(0).toUpperCase() + randomKey.slice(1);
        
        input.value = displayValue;
        
        // 3. Trigger input event to update stats/array
        input.dispatchEvent(new Event('input'));
    });

    if (typeof playSound === 'function') playSound('zap');
}

// NEW: Function to randomize the counts (#L vs #R)
function randomizeCounts() {
    const min = 1;
    const max = 15; // Cap at 15 to prevent lag, you can change this
    
    document.getElementById('p1Count').value = Math.floor(Math.random() * (max - min + 1)) + min;

    if (GAME_MODE !== 'ffa') {
        document.getElementById('p2Count').value = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    updateSquadUI();
    
    if (typeof playSound === 'function') playSound('zap');
}


        function loop() {
            frameCount++;
            if (hitStopTimer > 0) { hitStopTimer--; draw(); animationId = requestAnimationFrame(loop); return; }
            if (slowMoCooldown > 0) {
    slowMoCooldown--;
}

if (slowMoTimer > 0) {
    slowMoTimer--;

    if (slowMoTimer <= 0) {
        GAME_SPEED = BASE_GAME_SPEED;
    }
}
            
            // MODIFIED: Accumulator Logic for variable speed (supports 0.75x, 1.25x, etc.)
            if (gameActive && !isSetupPhase) { 
                speedAccumulator += GAME_SPEED;
                
                // Cap updates to prevent freezing if tab was inactive or speed is huge
                let loops = 0;
                while (speedAccumulator >= 1.0 && loops < 10) {
                    update();
                    speedAccumulator -= 1.0;
                    loops++;
                }
            } else if (gameActive && isSetupPhase) {
                // In setup phase, only update particle/portal visuals
                particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life--; p.alpha -= 0.02; if(p.type === 'note') { p.vy -= 0.1; } });
                particles = particles.filter(p => p.life > 0);
                // NEW: Update Damage Text
                damageText.forEach(t => { 
                    t.y += t.vy; 
                    t.life--; 
                   t.alpha = t.life / 15; 
                });
                damageText = damageText.filter(t => t.life > 0);
                portals.forEach(p => { p.life--; p.angle += 0.1; });
                portals = portals.filter(p => p.life > 0);
            }

            draw();
            animationId = requestAnimationFrame(loop);
        }
        
      function showCustomMessage(title, message) {
    const tempModal = document.getElementById('resultModal');
    const titleElem = document.getElementById('resultText');
    const msgContainer = document.getElementById('msgContainer');
    const playBtn = document.getElementById('playAgainBtn');

    // 1. Set the Title
    titleElem.innerText = title;
    
    // 2. Set the Message (This replaces old text instead of adding to it)
    if (msgContainer) msgContainer.innerText = message;

    // 3. Hide the Play Again button
    if (playBtn) playBtn.style.display = 'none';

    // 4. Show the Modal
    tempModal.style.display = 'block';

    // 5. Smart Timer: If a timer is already running, stop it! 
    // This keeps the modal open while you are clicking through options.
    if (modalTimeout) clearTimeout(modalTimeout);

    // 6. Start a new timer to close it after 2 seconds of inactivity
    modalTimeout = setTimeout(() => {
        tempModal.style.display = 'none';
        if (msgContainer) msgContainer.innerText = ''; // Clear the text
        if (playBtn) playBtn.style.display = 'inline-block'; // Bring button back
    }, 2000);
}



// --- LATE GAMEPLAY PATCH: FULLSCREEN SETUP + NEW FIGHTERS + SMARTER AI ---
function getDistance(a, b) {
    if (!a || !b) return Infinity;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getEnemyCandidatesFor(unit) {
    return entities.filter(ent =>
        ent &&
        ent.hp > 0 &&
        ent.id !== unit.id &&
        ent.team !== unit.team &&
        ent.type !== 'turret' &&
        ent.type !== 'boid' &&
        ent.type !== 'mammoth_mount' &&
        !ent.isStealthed &&
        !ent.isFeigning
    );
}

function findClosestEnemyFor(unit) {
    const enemies = getEnemyCandidatesFor(unit);
    let best = null;
    let bestDist = Infinity;

    enemies.forEach(enemy => {
        const d = getDistance(unit, enemy);
        if (d < bestDist) {
            bestDist = d;
            best = enemy;
        }
    });

    return best;
}

function setGameModeFromValue(mode) {
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.value = mode;
        toggleGameMode();
    }
}

function syncFullscreenSetupControls() {
    const modeSelect = document.getElementById('modeSelect');
    const fsMode = document.getElementById('fsModeSelect');
    const p1 = document.getElementById('p1Count');
    const p2 = document.getElementById('p2Count');
    const fsP1 = document.getElementById('fsP1Count');
    const fsP2 = document.getElementById('fsP2Count');

    if (modeSelect && fsMode && fsMode.value !== modeSelect.value) fsMode.value = modeSelect.value;
    if (p1 && fsP1 && fsP1.value !== p1.value) fsP1.value = p1.value;
    if (p2 && fsP2 && fsP2.value !== p2.value) fsP2.value = p2.value;
}

function fullscreenChangeGameMode(mode) {
    if (!isSetupPhase) {
        showCustomMessage('Fullscreen Setup', 'Reset before changing game mode.');
        syncFullscreenSetupControls();
        return;
    }

    setGameModeFromValue(mode);
    syncFullscreenSetupControls();
    updateFullscreenHud();
}

function fullscreenApplyCounts() {
    if (!isSetupPhase) {
        showCustomMessage('Fullscreen Setup', 'Reset before changing fighter count.');
        syncFullscreenSetupControls();
        return;
    }

    const fsP1 = document.getElementById('fsP1Count');
    const fsP2 = document.getElementById('fsP2Count');
    const p1 = document.getElementById('p1Count');
    const p2 = document.getElementById('p2Count');

    if (fsP1 && p1) p1.value = clamp(parseInt(fsP1.value) || 1, 1, 100);
    if (fsP2 && p2) p2.value = clamp(parseInt(fsP2.value) || 1, 1, 100);

    updateSquadUI();
    initializeSquads();
    resetPositions();
    syncFullscreenSetupControls();
    updateFullscreenHud();
}

function fullscreenRandomizeCounts() {
    if (!isSetupPhase) {
        showCustomMessage('Fullscreen Setup', 'Reset before randomizing count.');
        return;
    }

    randomizeCounts();
    syncFullscreenSetupControls();
    updateFullscreenHud();
}

function fullscreenRandomizeSquads(side = 'all') {
    if (!isSetupPhase) {
        showCustomMessage('Fullscreen Setup', 'Reset before randomizing fighters.');
        return;
    }

    randomizeSquads(side);
    syncFullscreenSetupControls();
    updateFullscreenHud();
}

function pickEffectiveFlashbangTarget(e) {
    const enemies = getEnemyCandidatesFor(e);
    let best = null;
    let bestScore = 0;

    enemies.forEach(enemy => {
        const d = getDistance(e, enemy);
        if (d > 420 || !hasLineOfSight(e, enemy)) return;

        const cluster = enemies.filter(other => getDistance(enemy, other) < 145).length;
        const closeToAdapto = d < 230 ? 1 : 0;
        const dangerous = ['scythe', 'samurai', 'rogue', 'laser', 'soldier', 'bow', 'wizard', 'mammoth'].includes(enemy.type) ? 1 : 0;
        const alliesNear = getAliveAlliesNear(e, enemy.x, enemy.y, 170).length;

        const score = cluster * 70 + closeToAdapto * 45 + dangerous * 35 - alliesNear * 95 - d * 0.08;

        if (score > bestScore) {
            bestScore = score;
            best = enemy;
        }
    });

    return bestScore >= 45 ? best : null;
}

function handleAquamarineAI(e) {
    if (e.type !== 'aquamarine') return false;

    const target = findClosestEnemyFor(e);
    if (!target) return false;

    e.target = target;

    const d = getDistance(e, target);
    const angle = Math.atan2(target.y - e.y, target.x - e.x);
    const kiteAngle = d < 180 ? angle + Math.PI : (d > 360 ? angle : angle + Math.PI / 2);

    e.angle = angle;
    e.vx += Math.cos(kiteAngle) * 0.36;
    e.vy += Math.sin(kiteAngle) * 0.36;

    return true;
}

function spawnAquamarineFish(e, target) {
    if (!target) return;

    const angle = Math.atan2(target.y - e.y, target.x - e.x);

    projectiles.push({
        x: e.x + Math.cos(angle) * (e.radius + 8),
        y: e.y + Math.sin(angle) * (e.radius + 8),
        vx: Math.cos(angle) * 7,
        vy: Math.sin(angle) * 7,
        team: e.team,
        life: 210,
        type: 'fish',
        targetId: target.id,
        shooterId: e.id,
        radius: 7,
        biteTimer: 0
    });

    spawnParticles(e.x, e.y, '#00cec9', 6);
    if (typeof playSound === 'function') playSound('zap', 0.35);
}

function sprayAquamarineWater(e, target) {
    if (!target) return;

    const angle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = angle;

    projectiles.push({
        x: e.x + Math.cos(angle) * (e.radius + 12),
        y: e.y + Math.sin(angle) * (e.radius + 12),
        vx: Math.cos(angle) * 16,
        vy: Math.sin(angle) * 16,
        team: e.team,
        life: 22,
        type: 'water',
        shooterId: e.id,
        radius: 8
    });

    spawnParticles(e.x + Math.cos(angle) * 18, e.y + Math.sin(angle) * 18, '#81ecec', 2);
}

function updateAquamarine(e) {
    if (e.type !== 'aquamarine' || e.isDancing) return;

    if (e.fishCooldown > 0) e.fishCooldown--;
    if (e.waterCooldown > 0) e.waterCooldown--;

    const target = e.target && e.target.hp > 0 ? e.target : findClosestEnemyFor(e);
    if (!target) return;

    const d = getDistance(e, target);

    if (e.fishCooldown <= 0 && d < 520 && hasLineOfSight(e, target)) {
        spawnAquamarineFish(e, target);
        e.fishCooldown = 90;
    }

    if (e.waterCooldown <= 0 && d < 285 && hasLineOfSight(e, target)) {
        sprayAquamarineWater(e, target);
        e.waterCooldown = 8;
    }
}

function handleMammothMountAI(e) {
    if (e.type !== 'mammoth_mount') return false;

    const owner = entities.find(ent => ent.id === e.ownerId && ent.hp > 0);
    if (!owner) {
        e.hp = 0;
        spawnParticles(e.x, e.y, '#8d6e63', 12);
        return true;
    }

    const target = owner.target && owner.target.hp > 0 ? owner.target : findClosestEnemyFor(owner);
    e.target = target || null;

    if (target) {
        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.angle = angle;
        e.vx += Math.cos(angle) * 0.42;
        e.vy += Math.sin(angle) * 0.42;
    } else {
        const d = getDistance(e, owner);
        if (d > 35) {
            const angle = Math.atan2(owner.y - e.y, owner.x - e.x);
            e.vx += Math.cos(angle) * 0.25;
            e.vy += Math.sin(angle) * 0.25;
        }
    }

    return true;
}

function ensureMammothMount(rider) {
    if (rider.type !== 'mammoth') return null;

    let mount = rider.mammothId ? entities.find(ent => ent.id === rider.mammothId && ent.hp > 0) : null;

    if (!mount && !isSetupPhase) {
        mount = createFighter('mammoth_mount', rider.x, rider.y + 12, rider.team, false, rider.id, null, rider.spawnSide, rider.spawnIndex);
        mount.ownerId = rider.id;
        mount.color = '#6d4c41';
        mount.originalType = 'mammoth_mount';
        mount.realType = 'mammoth_mount';
        entities.push(mount);
        rider.mammothId = mount.id;
        spawnParticles(rider.x, rider.y, '#8d6e63', 20);
        spawnDamageText(rider.x, rider.y - 34, 'MAMMOTH!', '#8d6e63', true);
    }

    return mount || null;
}

function handleMammothRiderAI(e) {
    if (e.type !== 'mammoth') return false;

    const target = findClosestEnemyFor(e);
    if (target) {
        e.target = target;
        e.angle = Math.atan2(target.y - e.y, target.x - e.x);
    }

    const mount = ensureMammothMount(e);
    if (mount && mount.hp > 0) {
        // The rider sits on top. The mount does the heavy movement/collision.
        e.x = mount.x;
        e.y = mount.y - 18;
        e.vx = mount.vx * 0.65;
        e.vy = mount.vy * 0.65;
        e.angle = mount.angle;
    }

    return false;
}

function updateMammothRider(e) {
    if (e.type !== 'mammoth') return;

    const mount = ensureMammothMount(e);
    if (!mount || mount.hp <= 0) return;

    if (e.mammothStompCooldown > 0) e.mammothStompCooldown--;

    const enemies = getEnemyCandidatesFor(e);
    enemies.forEach(enemy => {
        const d = getDistance(mount, enemy);
        if (d < mount.radius + enemy.radius + 18) {
            const angle = Math.atan2(enemy.y - mount.y, enemy.x - mount.x);

            if (e.mammothStompCooldown <= 0) {
                damageEntity(enemy, 7.5, enemy.x, enemy.y, e);
                enemy.vx += Math.cos(angle) * 8;
                enemy.vy += Math.sin(angle) * 8;
                spawnParticles(enemy.x, enemy.y, '#8d6e63', 12);
                spawnDamageText(enemy.x, enemy.y - 32, 'TRAMPLE', '#8d6e63', true);
                e.mammothStompCooldown = 24;
            } else {
                enemy.vx += Math.cos(angle) * 0.8;
                enemy.vy += Math.sin(angle) * 0.8;
            }
        }
    });
}

function handleBardPrecastAI(e) {
    if (e.type !== 'bard') return false;

    const target = findClosestEnemyFor(e);
    if (!target) return false;

    e.target = target;

    const d = getDistance(e, target);
    const needsSong = !target.isParanoid && !target.isDancing;
    const canSong = e.bardParanoiaCooldown <= 0 || e.bardDanceCooldown <= 0;

    if (needsSong && canSong) {
        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.angle = angle;

        // Close enough to sing, far enough to not blindly bonk first.
        if (d > 190) {
            e.vx += Math.cos(angle) * 0.35;
            e.vy += Math.sin(angle) * 0.35;
        } else if (d < 95) {
            e.vx -= Math.cos(angle) * 0.55;
            e.vy -= Math.sin(angle) * 0.55;
        } else {
            e.vx += Math.cos(angle + Math.PI / 2) * 0.22;
            e.vy += Math.sin(angle + Math.PI / 2) * 0.22;
        }

        return true;
    }

    return false;
}

function handleEliteTrapperAI(e) {
    if (e.type !== 'trapper') return false;

    if (e.trapCooldown > 0) e.trapCooldown--;
    if (e.mineCooldown > 0) e.mineCooldown--;
    if (e.wallCooldown > 0) e.wallCooldown--;

    const enemies = getEnemyCandidatesFor(e);
    if (enemies.length === 0) return true;

    const edgePad = 68;
    let centerPullX = 0;
    let centerPullY = 0;

    if (e.x < edgePad) centerPullX += 1;
    if (e.x > canvas.width - edgePad) centerPullX -= 1;
    if (e.y < edgePad) centerPullY += 1;
    if (e.y > canvas.height - edgePad) centerPullY -= 1;

    if (centerPullX || centerPullY) {
        const ang = Math.atan2(centerPullY, centerPullX);
        e.vx += Math.cos(ang) * 1.05;
        e.vy += Math.sin(ang) * 1.05;
    }

    let nearest = null;
    let nearestD = Infinity;

    enemies.forEach(enemy => {
        const d = getDistance(e, enemy);
        if (d < nearestD) {
            nearestD = d;
            nearest = enemy;
        }
    });

    const trapped = enemies
        .filter(enemy => enemy.trappedBy === e.id || enemy.frozen > 0)
        .sort((a, b) => getDistance(e, a) - getDistance(e, b))[0];

    const target = trapped && nearestD > 115 ? trapped : nearest;
    e.target = target;

    const angleToEnemy = Math.atan2(nearest.y - e.y, nearest.x - e.x);
    e.angle = Math.atan2(target.y - e.y, target.x - e.x);

    // Never put himself in a corner: choose lateral movement away from the nearest enemy.
    const flankDir = ((Math.floor(frameCount / 50) + Math.floor(e.id * 1000)) % 2 === 0) ? 1 : -1;
    const escapeAngle = angleToEnemy + Math.PI + flankDir * 0.55;

    const predictedX = nearest.x + (nearest.vx || 0) * 18;
    const predictedY = nearest.y + (nearest.vy || 0) * 18;

    if (nearestD < 260 && e.trapCooldown <= 0) {
        const trapX = e.x + Math.cos(angleToEnemy) * 55;
        const trapY = e.y + Math.sin(angleToEnemy) * 55;
        const spot = dropTrapForTrapper(e, trapX, trapY, angleToEnemy);

        if (spot) {
            e.trapCooldown = nearestD < 130 ? 42 : 65;
            spawnDamageText(e.x, e.y - 24, 'TRAP ROUTE', '#00cec9');
            spawnParticles(spot.x, spot.y, '#00cec9', 5);
        }
    }

    if (nearestD < 190 && e.mineCooldown <= 0) {
        const mineX = e.x + Math.cos(escapeAngle) * 42;
        const mineY = e.y + Math.sin(escapeAngle) * 42;
        const spot = dropMineForTrapper(e, mineX, mineY, escapeAngle);

        if (spot) {
            e.mineCooldown = 95;
            spawnParticles(spot.x, spot.y, '#ff7675', 5);
        }
    }

    if (trapped && nearestD > 120) {
        // Finish trapped prey, but only when not being rushed.
        const approach = Math.atan2(trapped.y - e.y, trapped.x - e.x);
        e.vx += Math.cos(approach) * 0.55;
        e.vy += Math.sin(approach) * 0.55;
        e.angle = approach;
    } else {
        // Kite, flank, and bait enemies through trap lines.
        e.vx += Math.cos(escapeAngle) * (nearestD < 145 ? 0.95 : 0.45);
        e.vy += Math.sin(escapeAngle) * (nearestD < 145 ? 0.95 : 0.45);
    }

    return true;
}

function updateEliteSupportFighters(e) {
    updateAquamarine(e);
    updateMammothRider(e);
}

function killOwnedMammothMount(ownerId) {
    entities.forEach(ent => {
        if (ent.type === 'mammoth_mount' && ent.ownerId === ownerId) {
            ent.hp = 0;
            spawnParticles(ent.x, ent.y, '#8d6e63', 18);
            spawnDamageText(ent.x, ent.y - 30, 'WITHERED', '#8d6e63', true);
        }
    });
}

        function update() {

    if (typeof updateFullscreenHud === 'function' && isWatchFullscreenActive && isWatchFullscreenActive() && frameCount % 15 === 0) {
        updateFullscreenHud();
    }

           // --- CAMERA LOGIC (SMOOTHER + REAL ZOOM) ---
    let targetX = camera.x;
    let targetY = camera.y;
    let desiredZoom = 1.0;
    let cinematicHasTarget = false;

    if (!camera.targetId && cinematicCameraEnabled && !isSetupPhase) {
        if (cinematicFocus.timer > 0) {
            targetX = cinematicFocus.x;
            targetY = cinematicFocus.y;
            desiredZoom = cinematicFocus.zoom || getCameraZoomForFocus('death');
            cinematicFocus.timer--;
            cinematicHasTarget = true;

            if (cinematicFocus.timer <= 0) {
                cinematicFocus.priority = 0;
            }
        } else {
            const fighterFocus = getCinematicFighterFocus();

            if (fighterFocus) {
                targetX = fighterFocus.x;
                targetY = fighterFocus.y;
                desiredZoom = fighterFocus.zoom || getCameraZoomForFocus('single');
                cinematicHasTarget = true;
            }
        }
    }

    if (!cinematicHasTarget && camera.targetId) {
        const target = entities.find(e => e.id === camera.targetId);

        if (target && target.hp > 0) {
            targetX = target.x;
            targetY = target.y;
            desiredZoom = getCameraZoomForFocus('tracked');
        } else {
            const survivors = entities.filter(e => e.type !== 'turret' && e.type !== 'boid' && e.hp > 0);

            if (survivors.length > 0) {
                const nextFighter = survivors[0];
                camera.targetId = nextFighter.id;
                targetX = nextFighter.x;
                targetY = nextFighter.y;
                desiredZoom = getCameraZoomForFocus('tracked');
            } else {
                camera.targetId = null;
            }

            updateTrackButtons();
        }
    }

    if (!cinematicHasTarget && !camera.targetId) {
        targetX = canvas.width / 2;
        targetY = canvas.height / 2;
        desiredZoom = 1.0;
    }

    const dxCam = targetX - camera.x;
    const dyCam = targetY - camera.y;
    const distCam = Math.sqrt(dxCam * dxCam + dyCam * dyCam);

    const panLerp = camera.targetId ? 0.065 : 0.035;
    const zoomLerp = camera.targetId ? 0.055 : 0.032;

    if (distCam > 2) {
        camera.x += dxCam * panLerp;
        camera.y += dyCam * panLerp;
    }

    camera.zoom += (desiredZoom - camera.zoom) * zoomLerp;
    camera.zoom = clamp(camera.zoom, 0.5, 3.0);
    // --- END CAMERA LOGIC ---


    // ADD THIS LOOP FOR BARREL PHYSICS
obstacles.forEach(o => {
    if (o.type === 'barrel') {
        o.vx = o.vx || 0;
        o.vy = o.vy || 0;
        o.friction = o.friction || 0.98;

        // Tactical barrel arming/fuse
        if (o.armTime > 0) o.armTime--;

        if (o.tacticalFuse !== undefined) {
            o.tacticalFuse--;
            if (o.tacticalFuse <= 0) {
                o.hp = 0;
            }
        }

        // Proximity detonation
        if (o.proximityArmed && o.armTime <= 0 && o.hp > 0) {
            const enemyNear = entities.find(ent =>
                ent &&
                ent.hp > 0 &&
                ent.team !== o.team &&
                ent.type !== 'turret' &&
                ent.type !== 'boid' &&
                Math.sqrt((ent.x - o.x) ** 2 + (ent.y - o.y) ** 2) < (o.detectionRadius || 65)
            );

            const allyNear = entities.find(ent =>
                ent &&
                ent.hp > 0 &&
                ent.team === o.team &&
                ent.id !== o.ownerId &&
                Math.sqrt((ent.x - o.x) ** 2 + (ent.y - o.y) ** 2) < 115
            );

            if (enemyNear && !allyNear) {
                o.hp = 0;
                spawnDamageText(o.x, o.y - 20, "TRIGGER!", "#ffcc00", true);
            }
        }

        // Apply velocity
        o.x += o.vx;
        o.y += o.vy;
        
        // Apply Friction
        o.vx *= o.friction;
        o.vy *= o.friction;

        // Wall Bouncing for Barrels
        if (o.x < o.radius) { o.x = o.radius; o.vx *= -0.8; }
        if (o.x > canvas.width - o.radius) { o.x = canvas.width - o.radius; o.vx *= -0.8; }
        if (o.y < o.radius) { o.y = o.radius; o.vy *= -0.8; }
        if (o.y > canvas.height - o.radius) { o.y = canvas.height - o.radius; o.vy *= -0.8; }
    }
});



            // Live count and Win Condition Check
            if (!gameOverTriggered) {
                updateLiveCounts(); // Always update the numbers
                
                // ONLY CHECK FOR WINNER IF NOT IN PET MODE
                if (GAME_MODE !== 'pet') { 
                    
                    if (GAME_MODE === 'ffa') {
                        // Check active fighters (unique teams alive)
                        let activeFighters = entities.filter(e => e.type !== 'turret' && e.hp > 0);
                        let uniqueTeams = [...new Set(activeFighters.map(e => e.team))];
                        
                        if (uniqueTeams.length <= 1 && entities.length > 0 && !isSetupPhase) {
                            if (uniqueTeams.length === 1) {
                                let winner = activeFighters[0];
                                endGame(`${getEntityName(winner)} Wins!`);
                            } else {
                                endGame("DRAW!");
                            }
                        }
                    } else {
                        // Standard Team Battle Win Check
                        let p1Alive = entities.filter(e => e.team === 1 && e.type !== 'turret').length;
                        let p2Alive = entities.filter(e => e.team === 2 && e.type !== 'turret').length;

                        if (p1Alive === 0 && entities.filter(e=>e.type!=='turret').length > 0) endGame("RIGHT WINS!");
                        else if (p2Alive === 0 && entities.filter(e=>e.type!=='turret').length > 0) endGame("LEFT WINS!");
                        else if (p1Alive === 0 && p2Alive === 0 && entities.length === 0) endGame("DRAW!");
                    }
                }
            }
            
            // Check for dead obstacles
            obstacles = obstacles.filter(o => {
                if (o.type === 'lava') return true; // Lava is indestructible

                if (o.hp <= 0) {

                    if (o.type === 'barrel') {
            triggerExplosion(o.x, o.y, 200, 80, o.ownerId || null); // Radius 200, Dmg 80

if (o.tactical) {
    logKill('Adapto Tactical Barrel', 'Someone', 0, 'was blown up by', 0);
} else {
    logKill('Explosive Barrel', 'Someone', 0, 'was blown up by', 0);
}

return false; // Remove it
        }

                    let debrisColor = '#555'; // Default Rock
            let name = 'Rock Obstacle';
            
            if (o.type === 'spike') { name = 'Spike Trap'; }
            if (o.type === 'wall_trap') { debrisColor = '#8B4513'; name = 'Barricade'; } // <--- ADD THIS

            logKill('Projectile/Melee Attacks', name, 0, 'was shattered by', 0);
            spawnParticles(o.x, o.y, debrisColor, 20, 'dot'); 
            playSound('explosion');
            return false;}
                return true;
            });


            entities.forEach(e => {

                if (e.stress > 0) e.stress--;

                applyPhysics(e);
                applyAI(e);
                handleWalls(e);
                
                if (e.flashTime > 0) e.flashTime--;
                if (e.teleportCooldown > 0) e.teleportCooldown--;
                if (e.frozen > 0) e.frozen--;

                // NEW: Cooldown Decrements (Trapper Fix)
                if (e.type === 'trapper') {
                    if (e.trapCooldown > 0) e.trapCooldown--;
                    if (e.mineCooldown > 0) e.mineCooldown--;
                }
                
                // BOW SPECIAL COOLDOWN
                if (e.type === 'bow' && e.flameCooldown > 0) e.flameCooldown--;
                
                // SPATIAL COOLDOWN DECREMENT
                if (e.type === 'spatial' && e.portalCooldown > 0) e.portalCooldown--;

                // UNARMED COOLDOWN DECREMENT (NEW)
                if (e.type === 'unarmed') {
                    if (e.chargeCooldown > 0) e.chargeCooldown--;
                }

                // CLEANUP PORTAL TRAPPED STATUS
                if (e.isPortalTrapped && e.frozen <= 0) e.isPortalTrapped = false;
                
                // PUSH/SLAM TIMER (NEW for Wall Slams)
                if (e.pushTimer > 0) e.pushTimer--;
                else e.lastPushedBy = null;


                // STATUS EFFECTS: Paranoia & Dance
                if (e.paranoiaTimer > 0) e.paranoiaTimer--;
                else e.isParanoid = false;

                if (e.danceTimer > 0) {
                    e.danceTimer--;
                    if (frameCount % 10 === 0) spawnParticles(e.x, e.y + (Math.random()-0.5)*20, 'magenta', 1, 'note');
                    // Shimmy effect
                    e.vx += Math.sin(frameCount * 0.5) * 0.5;
                } else {
                    e.isDancing = false;
                }
                
                // BURN STATUS LOGIC (NEW)
                if (e.burnTimer > 0) {
                    e.burnTimer--;
                    // Deal damage every 30 frames (0.5s) -> 4 ticks total for 2s
                    if (e.burnTimer % 30 === 0) {
                        // Total damage approx normal arrow damage spread out. 
                        // Let's make it sting: 3 damage per tick = 12 total.
                        let source = entities.find(s => s.id === e.burnSourceId);
                        damageEntity(e, 3, e.x, e.y, source);
                        spawnParticles(e.x, e.y, 'orange', 3);
                    }
                    if (frameCount % 10 === 0) spawnParticles(e.x, e.y - 10, 'red', 1); // Visual smoke/fire
                }

                // GRAPPLED STATE LOGIC (PULL TO GRABBER)
                if (e.grappledBy) {
                    let grappler = entities.find(g => g.id === e.grappledBy);
                    // Break grapple if grappler dead or too far (sanity check)
                    if (!grappler || grappler.hp <= 0 || grappler.heldTargets.length >= 2) {
                        e.grappledBy = null;
                        e.frozen = 0;
                    } else {
                        // Pull logic
                        let dx = grappler.x - e.x;
                        let dy = grappler.y - e.y;
                        let dist = Math.sqrt(dx*dx + dy*dy);
                        
                        if (dist < grappler.radius + e.radius + 15) {
                             // Let collision logic handle the pickup
                             e.grappledBy = null; 
                             e.frozen = 0;
                        } else {
                             let angle = Math.atan2(dy, dx);
                             e.vx = Math.cos(angle) * 15; // Fast pull
                             e.vy = Math.sin(angle) * 15;
                             e.frozen = 2; // Prevent own movement logic
                        }
                    }
                }

                // POISON LOGIC
                if (e.poisonTimer > 0) {
                    e.hp -= (10 / 60); // 10 HP per second
                    if (e.hp < 0) e.hp = 0; // Add this line
                    e.poisonTimer--;
                    if (frameCount % 15 === 0) spawnParticles(e.x, e.y, '#90ee90', 1); // Sickly bubbles
                    
                    // NEW: Record poison as attacker for decay damage
                    if (e.poisonTimer > 0 && frameCount % 10 === 0) {
                        e.lastAttackerId = 'poison'; 
                    }
                }

                // BLIGHT LOGIC (Necromancer Debuff)
                if (e.blightTimer > 0) {
                    e.clashTimer = 0; // Reset clash on victim
                    e.blightTimer--;
                    
                    // 1. Slow Down
                    e.vx *= 0.85; 
                    e.vy *= 0.85;

                    // 2. Damage Over Time
                    if (frameCount % 10 === 0) {
                        let source = entities.find(n => n.id === e.blightedBy);
                        let dotDmg = 0.8;
                        damageEntity(e, dotDmg, e.x, e.y, source); 
                        spawnParticles(e.x, e.y, '#32cd32', 1); 
                        
                        // LIFESTEAL
                        if (source && source.hp > 0 && source.hp < source.maxHp) {
                            source.hp = Math.min(source.hp + dotDmg, source.maxHp);
                            spawnParticles(source.x, source.y, '#32cd32', 1);
                        }
                    }
                }
                
                // LAVA LOGIC (NEW)
                obstacles.forEach(o => {
                    if (o.type === 'lava') {
                        let dx = e.x - o.x;
                        let dy = e.y - o.y;
                        let d = Math.sqrt(dx*dx + dy*dy);
                        
                        if (d < o.radius + e.radius) {
                             // Inside Lava
                             if (frameCount % 30 === 0) { // Every 0.5s
                                 damageEntity(e, 5, e.x, e.y, null);
                                 e.lastAttackerId = 'lava'; // Tag for death msg
                                 spawnParticles(e.x, e.y, 'orange', 3);
                             }
                             // Slow down
                             e.vx *= 0.8;
                             e.vy *= 0.8;
                        }
                    }
                });

                if (e.type === 'grower') {
                    if (e.type === 'grower') {
    // FIX: Only grow/heal if actually alive
    if (e.hp > 0 && e.radius < e.maxRadius) { 
        e.radius += e.growthRate; 
        e.mass = e.radius / 8; 
        e.hp += 0.05; 
    }
}
                }
                
                // BARD LOGIC
                if (e.type === 'bard') {
                    if (e.bardParanoiaCooldown > 0) e.bardParanoiaCooldown--;
                    if (e.bardDanceCooldown > 0) e.bardDanceCooldown--;

                    let targets = entities.filter(ent => ent.team !== e.team && !ent.isStealthed && ent.hp > 0);
                    let usefulTargets = targets.filter(t => !t.isParanoid && !t.isDancing);

                    // BARD SMART PRECAST: disable first, bonk second.
                    if (usefulTargets.length > 0) {
                        let closest = usefulTargets
                            .map(t => ({ t, d: Math.sqrt((t.x - e.x)**2 + (t.y - e.y)**2) }))
                            .sort((a, b) => a.d - b.d)[0];

                        if (closest) {
                            e.target = closest.t;
                        }
                    }

                    // Dance is defensive: use it first when enemies are close.
                    if (e.bardDanceCooldown <= 0) {
                        let hitCount = 0;
                        usefulTargets.forEach(t => {
                            const d = Math.sqrt((t.x - e.x)**2 + (t.y - e.y)**2);
                            if (d < 205 && hasLineOfSight(e, t)) {
                                t.danceTimer = 130;
                                t.isDancing = true;
                                t.isParanoid = false;
                                t.paranoiaTimer = 0;
                                spawnParticles(t.x, t.y, 'magenta', 5, 'note');
                                hitCount++;
                            }
                        });
                        if (hitCount > 0) {
                            playSound('note');
                            spawnParticles(e.x, e.y, 'magenta', 10, 'note');
                            spawnDamageText(e.x, e.y - 26, "DANCE FIRST", "magenta", true);
                            e.bardDanceCooldown = 270;
                        }
                    }

                    // Paranoia is for groups / backline disruption.
                    if (e.bardParanoiaCooldown <= 0) {
                        let hitCount = 0;
                        usefulTargets.forEach(t => {
                            const nearby = targets.filter(other => other !== t && Math.sqrt((other.x - t.x)**2 + (other.y - t.y)**2) < 145).length;
                            const d = Math.sqrt((t.x - e.x)**2 + (t.y - e.y)**2);

                            if (d < 255 && hasLineOfSight(e, t) && (nearby > 0 || d < 160)) {
                                t.paranoiaTimer = 190;
                                t.isParanoid = true;
                                t.isDancing = false;
                                t.danceTimer = 0;
                                spawnParticles(t.x, t.y, 'red', 5, 'dot');
                                hitCount++;
                            }
                        });
                        if (hitCount > 0) {
                            playSound('note');
                            spawnParticles(e.x, e.y, 'red', 10, 'note');
                            spawnDamageText(e.x, e.y - 42, "PARANOIA", "red", true);
                            e.bardParanoiaCooldown = 300;
                        }
                    }
                }

                // ENGINEER AI
                if (e.type === 'engineer') {
                    e.turretTimer++;
                    // Check how many turrets this specific engineer owns
                    let myTurrets = entities.filter(ent => ent.type === 'turret' && ent.ownerId === e.id && ent.hp > 0).length;

                    if (e.turretTimer > 120 && myTurrets < e.turretMax) { // Every 2 seconds
                        const turretSpot = findEngineerTurretSpot(e);
                        spawnTurret(turretSpot.x, turretSpot.y, e.team, e.id);
                        e.turretTimer = 0;
                    }
                }

                // ADAPTO AI
if (e.type === 'adapto') {
    e.adaptTimer++;

    if (e.barrelCooldown === undefined) e.barrelCooldown = 0;
    if (e.barrelCooldown > 0) e.barrelCooldown--;
    // -----------------------------------------------------
    // 1. STRATEGY: FLASHBANG LOGIC (Runs at all times)
    // -----------------------------------------------------
    if (e.flashbangCooldown > 0) e.flashbangCooldown--;

    let shouldThrow = false;
    
    // Effective flashbang logic. No more wasteful opening throw.
    const flashTarget = e.flashbangCooldown <= 0 ? pickEffectiveFlashbangTarget(e) : null;
    if (flashTarget) {
        e.target = flashTarget;
        shouldThrow = true;
    }

    // EXECUTE THROW only when it is likely to hit/disable something useful.
    if (shouldThrow && e.flashbangCooldown <= 0 && e.target) {
         if (shootFlashbang(e)) {
             e.flashbangCooldown = 210;
             e.currentMode = 'assess';
             e.hasOpenedWithFlash = true;
         }
    }
    // -----------------------------------------------------
    // 1.5 TACTICAL BARREL LOGIC
    // -----------------------------------------------------
    if (
        e.barrelCooldown <= 0 &&
        !e.isDancing &&
        e.hp > 0 &&
        e.target &&
        e.adaptTimer > 120 &&
        e.hasOpenedWithFlash
    ) {
        const barrelTarget = findBestAdaptoBarrelTarget(e);

        if (barrelTarget) {
            e.target = barrelTarget;
            e.currentMode = 'gun';
            launchAdaptoBarrel(e, barrelTarget);
        }
    }
    // -----------------------------------------------------
    // 2. PHASE 1: ASSESSMENT (Movement only)
    // -----------------------------------------------------
    if (e.adaptTimer < 60) {
        e.currentMode = 'assess';
        
        // EMERGENCY OVERRIDE: If a projectile is about to hit, Shield UP!
        let incoming = projectiles.find(p => p.team !== e.team && Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2) < 120);
        if (incoming) e.currentMode = 'shield';
    }
    
    // -----------------------------------------------------
    // 3. PHASE 2: COMBAT (Standard Fighting)
    // -----------------------------------------------------
    else {
        // 0. COUNTER-ATTACK (Highest Priority)
        if (e.counterTimer > 0) {
            e.counterTimer--; 
            e.currentMode = 'sword';
        }
        // 1. PROJECTILE BLOCK (High Priority)
        else if (projectiles.some(p => p.team !== e.team && Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2) < 160)) {
            e.currentMode = 'shield';
        }
        // 2. DISTANCE LOGIC
        else if (e.target) {
            let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
            if (dist > 150) e.currentMode = 'gun';
            else {
                // Close Range Logic
                let angleToMe = Math.atan2(e.y - e.target.y, e.x - e.target.x);
                let facingDiff = Math.abs(angleToMe - e.target.angle);
                while (facingDiff > Math.PI) facingDiff = 2*Math.PI - facingDiff;
                while (facingDiff < -Math.PI) facingDiff += 2*Math.PI;

                // If they are looking at us (< 45 degrees), BLOCK!
                if (Math.abs(facingDiff) < 0.8) e.currentMode = 'shield';
                else e.currentMode = 'sword'; // Flank/Attack
            }
        }
    }

    // -----------------------------------------------------
    // 4. PHASE 3: LOOP & SHOOTING (Your requested addition)
    // -----------------------------------------------------
    
    // Every 5 seconds (300 frames), reset to 0 to re-assess the situation
    if (e.adaptTimer > 300) e.adaptTimer = 0;

    // Shooting Logic (Predictive & Strict)
if (e.currentMode === 'gun' && e.target && !e.isDancing) {
     const smartBarrel = findAdaptoShootableBarrel(e);
     const aimTarget = smartBarrel || e.target;

     // 1. Re-calculate the predictive angle to ensure we are lined up
     const bulletSpeed = 15;
     const dist = Math.sqrt((aimTarget.x - e.x)**2 + (aimTarget.y - e.y)**2);
     const timeToHit = dist / bulletSpeed;

     const predX = aimTarget.x + ((aimTarget.vx || 0) * timeToHit);
     const predY = aimTarget.y + ((aimTarget.vy || 0) * timeToHit);
     const aimAngle = Math.atan2(predY - e.y, predX - e.x);

     // 2. Check alignment
     let angleDiff = Math.abs(e.angle - aimAngle);
     while (angleDiff > Math.PI) angleDiff = 2*Math.PI - angleDiff;

     // Barrels are bigger than fighters, so he can shoot them slightly faster/easier
     const fireDelay = smartBarrel ? 18 : 45;
     const tolerance = smartBarrel ? 0.35 : 0.2;

     // 3. Fire only if aligned and LOS is clear
     if (frameCount % fireDelay === 0 && angleDiff < tolerance && hasLineOfSight(e, aimTarget)) {
         shootBullet(e); 
     }
}
}
                // TURRET LOGIC
                if (e.type === 'turret') {
                    e.vx = 0; e.vy = 0; // Ensure static
                    e.hp -= 0.05; // Battery drain/Decay
                    
                    if (e.isDancing) { e.target = null; } // Stunned turret
                    else {
                        e.fireTimer++;
                        if (e.fireTimer > 60 && e.target) { // Fire every 1s
                             // Check LOS for turrets
                             if (hasLineOfSight(e, e.target)) {
                                 let spawnX = e.x + Math.cos(e.angle) * 20;
                                 let spawnY = e.y + Math.sin(e.angle) * 20;
                                 projectiles.push({
                                    x: spawnX, y: spawnY,
                                    vx: Math.cos(e.angle) * 12,
                                    vy: Math.sin(e.angle) * 12,
                                    team: e.team, life: 60, type: 'bullet',
                                    shooterId: e.id 
                                 });
                                 e.fireTimer = 0;
                                 playSound('turret');
                            }
                        }
                    }
                }

                // VAMPIRE LOGIC
                if (e.type === 'vampire') {
                    if (e.isBat) {
                        e.batTimer--;
                        if (e.batTimer <= 0) {
                            e.isBat = false;
                            e.radius = 20; // Normal size
                            e.batCooldown = 180; // 3s Cooldown
                            spawnParticles(e.x, e.y, '#222', 10);
                        }
                    } else {
                        if (e.batCooldown > 0) e.batCooldown--;
                        
                        // Bat Trigger (Defensive)
                        let healthLow = e.hp < e.maxHp * 0.4;
                        let underAttack = false;
                        
                        // Check for incoming projectiles
                        if (projectiles.some(p => p.team !== e.team && Math.sqrt((p.x-e.x)**2 + (p.y-e.y)**2) < 100)) underAttack = true;

                        if (e.batCooldown <= 0 && (healthLow || underAttack) && !e.isDancing) {
                             e.isBat = true;
                             e.batTimer = 120; // 2s Duration
                             e.radius = 10; // Small
                             spawnParticles(e.x, e.y, '#222', 10);
                             playSound('bat');
                        }
                    }
                }

                // ALCHEMIST AI UPDATE
                if (e.type === 'alchemist') {
                    e.potionTimer++;
                    
                    // 1. FASTER COOLDOWN: Changed from 120 to 60 (1 second per shot)
                    // This is required so he can hit the combo before the freeze wears off.
                    if (e.potionTimer > 60 && e.target && !e.isDancing) { 
                        let d = Math.sqrt((e.target.x-e.x)**2 + (e.target.y-e.y)**2);
                        
                        // Range check (keep at 400 or reduce to 300 to be closer for combos)
                        if (d < 400 && hasLineOfSight(e, e.target)) {
                            e.potionTimer = 0;
                            
                            // --- NEW COMBO LOGIC ---
                            let pType = 'purple'; // Default

                            // Cycle 0: First Freeze
                            if (e.potionCycle === 0) {
                                pType = 'purple';
                            } 
                            // Cycle 1: Poison
                            else if (e.potionCycle === 1) {
                                pType = 'green';
                            }
                            // Cycle 2: Second Freeze (To ensure they are stuck for the blast)
                            else if (e.potionCycle === 2) {
                                pType = 'purple';
                            }
                            // Cycle 3: THE CHECK
                            else if (e.potionCycle === 3) {
                                // Check if target is suffering from BOTH Poison AND Freeze
                                if (e.target.poisonTimer > 0 && e.target.frozen > 0) {
                                    pType = 'orange'; // SUCCESS: BLAST!
                                } else {
                                    // FAILED: They aren't ready. Restart loop at Freeze immediately.
                                    pType = 'purple'; 
                                    e.potionCycle = 0; 
                                }
                            }

                            // Advance Cycle (Loop back to 0 after 3)
                            e.potionCycle++;
                            if (e.potionCycle > 3) e.potionCycle = 0;
                            // -----------------------

                            // Predictive Aiming (Keep this if you added it previously)
                            const projSpeed = 8;
                            let timeToHit = d / projSpeed;
                            let predictedX = e.target.x + (e.target.vx * timeToHit);
                            let predictedY = e.target.y + (e.target.vy * timeToHit);
                            let dx = predictedX - e.x;
                            let dy = predictedY - e.y;
                            let angle = Math.atan2(dy, dx);
                            
                            projectiles.push({
                                x: e.x, y: e.y,
                                vx: Math.cos(angle) * projSpeed, vy: Math.sin(angle) * projSpeed,
                                team: e.team, life: 60, type: 'potion', pType: pType,
                                targetX: predictedX, targetY: predictedY,
                                shooterId: e.id 
                            });
                        }
                    }
                }

               // CHRONO
if (e.type === 'chrono') {
    // Record history every 10 frames (approx 0.16s) for smoother rewinds
    if (frameCount % 10 === 0) {
        e.history.push({x: e.x, y: e.y, hp: e.hp});
        // Keep exactly 1 second of history (60 frames / 10 = 6 snapshots)
        if (e.history.length > 6) e.history.shift(); 
    }
    
    e.rewindTimer++;
    if (e.rewindTimer > 80 && !e.isDancing) { 
        if (e.history.length > 0) {
            let past = e.history[0]; // The oldest snapshot (1s ago)
            spawnParticles(e.x, e.y, 'cyan', 10);
            e.x = past.x; e.y = past.y;
            if (e.hp < past.hp) e.hp = past.hp; // Heal to previous state
            spawnParticles(e.x, e.y, 'cyan', 10);
            playSound('zap');
        }
        e.rewindTimer = 0;
        e.history = []; // Clear history to start a new timeline
    }
}

                // SAMURAI
                if (e.type === 'samurai') {
                    if (e.dashCooldown > 0) e.dashCooldown--;
                    
                    if (e.dashCooldown <= 0 && e.target && !e.isDancing) {
                        let d = Math.sqrt((e.target.x-e.x)**2 + (e.target.y-e.y)**2);
                        if (d < 250 && d > 50) {
                            // Dash Trigger
                            e.dashCooldown = 210; // 3.5s
                            
                            // Teleport behind target
                            let angle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                            let oldX = e.x; let oldY = e.y;
                            e.x = e.target.x + Math.cos(angle) * 60;
                            e.y = e.target.y + Math.sin(angle) * 60;
                            
                            // Visuals
                            spawnParticles(oldX, oldY, 'white', 5);
                            spawnParticles(e.x, e.y, 'white', 5);
                            playSound('clash');
                            
                            // Add Delayed Damage
                            delayedDamageEvents.push({
                                timer: 60, // 1s
                                targetId: e.target.id,
                                attackerId: e.id,
                                damage: 40 
                            });
                        }
                    }
                }
                
                if (e.type === 'regenerator') {
                    if (e.hp < e.maxHp && e.hp > 0) e.hp += 0.2; 
                    if (frameCount % 10 === 0) {
                        let pals = entities.filter(p => p.team === e.team && p.id !== e.id);
                        pals.forEach(p => {
                            let d = Math.sqrt((p.x-e.x)**2 + (p.y-e.y)**2);
                            if(d < 50 && p.hp < p.maxHp) { p.hp += 1; spawnParticles(p.x, p.y, 'lime', 1); }
                        });
                    }
                }

                if (e.type === 'spatial') {
                    // Portal Trap & Slam Logic (UPDATED: Multi-target)
                    if (e.portalCooldown <= 0 && e.target && !e.isDancing) { 
                        let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                        if (dist < 300 && hasLineOfSight(e, e.target)) {
                            // Scan for up to 3 enemies in range
                            let targets = entities.filter(ent => 
                                ent.team !== e.team && 
                                Math.sqrt((ent.x - e.x)**2 + (ent.y - e.y)**2) < 300 &&
                                hasLineOfSight(e, ent)
                            ).slice(0, 3);

                            if (targets.length > 0) {
                                // Trigger Ability
                                e.portalCooldown = 240; // 4 seconds CD
                                
                                targets.forEach(t => {
                                    t.frozen = 120; // Freeze for 2s
                                    t.vx = 0; t.vy = 0;
                                    t.isPortalTrapped = true; // Visual flag
                                    e.slamTargets.push(t.id); // Add to hit list
                                    spawnParticles(t.x, t.y, 'cyan', 20); // Portal effect
                                });
                                
                                e.slamTimer = 180; // 3 seconds window to hit everyone
                                playSound('zap');
                            }
                        }
                    }
                    
                    // --- FIND THIS IN update() AND DELETE IT ---

// NEW: Escape Logic (Counter Grabber & Trapper)
if ((e.heldBy || e.trappedBy) && e.teleportCooldown <= 0) {
     // Escape!
     e.teleportCooldown = 180; // 3s cooldown
     
     // Visuals
     spawnParticles(e.x, e.y, 'cyan', 15);
     playSound('zap');
     
     // Teleport
     e.x = Math.max(50, Math.min(canvas.width - 50, Math.random() * canvas.width));
     e.y = Math.max(50, Math.min(canvas.height - 50, Math.random() * canvas.height));
     
     // Clear Status
     e.frozen = 0;
     
     // Handle Grabber Release
     if (e.heldBy) {
         let grabber = entities.find(g => g.id === e.heldBy);
         if (grabber) {
             grabber.heldTargets = grabber.heldTargets.filter(id => id !== e.id);
         }
         e.heldBy = null;
     }
     
     // Handle Trapper Release
     if (e.trappedBy) {
         let trap = traps.find(t => t.trappedEnemyId === e.id);
         if (trap) {
             trap.trappedEnemyId = null;
             trap.life = 0; // Destroy trap
         }
         e.trappedBy = null;
     }
     
     spawnParticles(e.x, e.y, 'cyan', 15);
}
                    
                    // Override movement if slamming (UPDATED: Pinball Logic)
                    if (e.slamTargets.length > 0) {
                        e.slamTimer--;
                        // Clean up dead targets or expired timer
                        e.slamTargets = e.slamTargets.filter(tid => {
                            let t = entities.find(ent => ent.id === tid);
                            return t && t.hp > 0;
                        });

                        if (e.slamTimer > 0 && e.slamTargets.length > 0) {
                            let currentTargetId = e.slamTargets[0]; // Target the first one in queue
                            let target = entities.find(t => t.id === currentTargetId);
                            
                            if (target) {
                                // Pinball Rush speed
                                let angle = Math.atan2(target.y - e.y, target.x - e.x);
                                e.vx = Math.cos(angle) * 20; // Extremely fast
                                e.vy = Math.sin(angle) * 20;
                                e.angle = angle;
                                return; // Skip normal physics/AI
                            }
                        } else {
                            // Done slamming
                            e.slamTargets = [];
                        }
                    }
                }

                if (e.type === 'devourer') {
                    e.hp -= 1/60; if (e.hp <= 0) e.hp = 0; 
                    e.dampenTimer++;
                    if (e.dampenTimer > 240 && !e.isDancing) { 
                        e.dampenTimer = 0; e.isDampening = true; e.dampenDuration = 120; 
                        playSound('explosion'); spawnParticles(e.x, e.y, 'red', 30);
                        entities.forEach(victim => {
                            if (victim.team !== e.team) {
                                if (victim.originalType === 'duplicator' && !victim.isOriginal) {
                                    victim.hp = 0; spawnParticles(victim.x, victim.y, 'black', 10);
                                } else if (victim.type !== 'devourer') {
                                    victim.type = 'unarmed'; applyClassProps(victim, 'unarmed');
                                }
                            }
                        });
                    }
                    if (e.isDampening) {
                        e.dampenDuration--;
                        if (e.dampenDuration <= 0) {
                            e.isDampening = false;
                            entities.forEach(victim => {
                                if (victim.team !== e.team && victim.type === 'unarmed' && victim.originalType !== 'unarmed') {
                                    victim.type = victim.originalType; applyClassProps(victim, victim.type);
                                }
                            });
                        }
                    }
                }

                if (e.type === 'whispers') {
                    if (e.isControlling) {
                        e.whisperTimer--;
                        if (e.whisperTimer <= 0) e.isControlling = false;
                    } else {
                        if (e.whisperTimer <= 0 && !e.isDancing) {
                            let enemies = entities.filter(ent => ent.team !== e.team);
                            if (enemies.length > 0) {
                                let victim = enemies[Math.floor(Math.random() * enemies.length)];
                                e.isControlling = true; e.whisperTimer = 90; 
                                playSound('zap'); spawnParticles(victim.x, victim.y, 'purple', 10);
                                if (Math.random() > 0.5) {
                                    damageEntity(victim, 30, victim.x, victim.y, e);
                                    victim.vx = (Math.random()-0.5)*20; victim.vy = (Math.random()-0.5)*20;
                                } else {
                                    victim.vx = (e.x - victim.x) * -0.8; victim.vy = (e.y - victim.y) * -0.8;
                                }
                            } else e.whisperTimer = 60; 
                        }
                    }
                }

                if (e.realType === 'chameleon') {
                    const copiedTarget = e.mimicTargetId ? entities.find(ent => ent.id === e.mimicTargetId && ent.hp > 0) : null;
                    const strongestCopyTarget = getStrongestCopyTarget(e);

                    const shouldRecheckCopy =
                        e.isScanning ||
                        !copiedTarget ||
                        (frameCount % 90 === 0 && strongestCopyTarget && strongestCopyTarget.id !== e.mimicTargetId);

                    if (shouldRecheckCopy && !e.isDancing) {
                        e.mimicTimer++;

                        if (strongestCopyTarget && (e.isScanning || e.mimicTimer > 25 || !copiedTarget)) {
                            e.mimicTimer = 0;

                            if (e.type !== strongestCopyTarget.type || e.mimicTargetId !== strongestCopyTarget.id) {
                                copyChameleonTarget(e, strongestCopyTarget);
                            }
                        } else if (!strongestCopyTarget) {
                            e.type = 'chameleon';
                            applyClassProps(e, 'chameleon');
                            e.isScanning = true;
                            e.mimicTargetId = null;
                            e.mimicTimer = 0;
                        }
                    }
                }

                if (e.type === 'rogue') {
                    if (e.stealthCooldown > 0) e.stealthCooldown--;
                    if (e.stealthCooldown <= 0 && !e.isStealthed && !e.isDancing) {
                        e.isStealthed = true; e.stealthTimer = 120; spawnParticles(e.x, e.y, 'gray', 5);
                    }
                    if (e.isStealthed) {
                        e.stealthTimer--; if (e.stealthTimer <= 0) { e.isStealthed = false; e.stealthCooldown = 150; }
                    }
                }

                if (e.type === 'duplicator') {
                    e.dupeTimer++;
                    let maxDupes = 12;
                    let teamCount = entities.filter(t => t.team === e.team).length;
                    if (e.dupeTimer > 60 && teamCount < maxDupes && !e.isDancing) {
                        if (e.isOriginal && e.generation === 1 && e.dupeTimer < 120) { } else {
                            e.dupeTimer = 0; spawnDupe(e);
                        }
                    }
                }

                if (e.type === 'grabber') {
                    if (e.grabCooldown > 0) e.grabCooldown--;
                    
                    // Update Held Targets (Crush Damage)
                    e.heldTargets = e.heldTargets.filter(id => {
                        let victim = entities.find(v => v.id === id);
                        if (!victim || victim.hp <= 0) return false;
                        
                        // Pin victim to Grabber
                        victim.x = e.x + Math.cos(e.angle) * 20; 
                        victim.y = e.y + Math.sin(e.angle) * 20;
                        victim.frozen = 2; 
                        
                        // Crush Damage
                        let damagePerFrame = (victim.maxHp * 0.35) / 120;
                        victim.hp -= damagePerFrame;
                        
                        if (typeof victim.grabTimer === 'undefined') victim.grabTimer = 120;
                        victim.grabTimer--;
                        victim.lastAttackerId = e.id;
                        
                        if (frameCount % 10 === 0) spawnParticles(victim.x, victim.y, 'red', 1);

                        // Release if timer ends
                        if (victim.grabTimer <= 0) {
                            victim.frozen = 0;
                            victim.heldBy = null;
                            e.grabCooldown = 180; 
                            return false; 
                        }
                        return true;
                    });
                    
                    // --- SLAM LOGIC START ---
                    if (e.heldTargets.length > 0) {
                        let slamOccurred = false;
                        let slamDamage = 0;
                        let debrisColor = 'white';

                        // 1. Check Walls
                        let hitWall = (e.x < 30 || e.x > canvas.width - 30 || e.y < 30 || e.y > canvas.height - 30);
                        if (hitWall) {
                            slamOccurred = true;
                            slamDamage = 50; // Base Wall Slam (50)
                        }

                        // 2. Check Obstacles (Rocks/Spikes)
                        if (!slamOccurred) {
                            for (let o of obstacles) {
                                // Ignore non-solid hazards like lava for slamming
                                if (o.type === 'lava' || o.type === 'ice') continue; 
                                
                                let dist = Math.sqrt((e.x - o.x)**2 + (e.y - o.y)**2);
                                if (dist < e.radius + o.radius + 15) {
                                    slamOccurred = true;
                                    o.hp = 0; // DESTROY OBSTACLE
                                    
                                    if (o.type === 'spike') {
                                        slamDamage = 250; // Massive Spike Damage
                                        debrisColor = '#555';
                                    } else {
                                        slamDamage = 150; // Rock/Wall Trap Damage
                                        debrisColor = '#8B4513';
                                    }
                                    break;
                                }
                            }
                        }

                        // 3. Check Mines
                        if (!slamOccurred) {
                            for (let p of projectiles) {
                                if (p.isMine) {
                                    let dist = Math.sqrt((e.x - p.x)**2 + (e.y - p.y)**2);
                                    if (dist < e.radius + p.radius + 15) {
                                        slamOccurred = true;
                                        p.dead = true; // DESTROY MINE
                                        slamDamage = 200; // Mine Explosion Slam
                                        debrisColor = 'red';
                                        spawnParticles(p.x, p.y, 'orange', 20); // Boom
                                        break;
                                    }
                                }
                            }
                        }

                        // EXECUTE SLAM
                        if (slamOccurred) {
                            playSound('explosion'); 
                            triggerHitStop(20);
                            spawnParticles(e.x, e.y, debrisColor, 20);

                            // Apply to all held victims
                            e.heldTargets.forEach(id => {
                                let victim = entities.find(v => v.id === id);
                                if (victim) {
                                    // Deal Damage
                                    damageEntity(victim, slamDamage, e.x, e.y, e); 
                                    
                                    // Visual Text
                                    let txt = slamDamage > 200 ? "FATAL SLAM!" : "SLAM!";
                                    spawnDamageText(victim.x, victim.y - 30, txt, "#ff0000", true);
                                    
                                    // Bounce them away towards center
                                    let bounceAngle = Math.atan2(canvas.height/2 - e.y, canvas.width/2 - e.x);
                                    victim.vx = Math.cos(bounceAngle) * 15; 
                                    victim.vy = Math.sin(bounceAngle) * 15;
                                    
                                    // Release
                                    victim.frozen = 0; 
                                    victim.heldBy = null;
                                }
                            });
                            
                            // Reset Grabber
                            e.heldTargets = []; 
                            e.grabCooldown = 180; 
                            e.dropThreshold = 20; 
                        }
                    }
                    // --- SLAM LOGIC END ---
                }

                                // NEW CALCULATING SOLDIER LOGIC (FIXED)
                if (e.type === 'soldier' || e.type === 'dualist') {
                    const burstDuration = 180; // 3 seconds
                    const reloadDuration = e.type === 'dualist' ? 30 : 120;
                    const effectiveRange = e.reach || 10000;

                    const target = e.overrideShootTarget || e.target;
                    const targetInRange = target && Math.sqrt((target.x - e.x)**2 + (target.y - e.y)**2) < effectiveRange;
                    const canShoot = target && targetInRange && !e.isDancing && hasLineOfSight(e, target);

                    if (e.state === 'firing') {
                        e.fireTimer++;

                        // Stop firing if burst is over or target is gone/blocked
                        if (e.fireTimer >= burstDuration || !canShoot) {
                            e.state = 'reloading';
                            e.fireTimer = 0;
                            e.reloadTimer = 1;
                            playSound('reload');
                        } else {
                            // Dualist shoots slower, Soldier shoots faster
                            const fireRate = e.type === 'dualist' ? 20 : 10;

                            if (e.fireTimer % fireRate === 0) {
                                if (e.type === 'dualist') {
                                    shootDualdualist(e);
                                } else {
                                    shootBullet(e);
                                }
                            }
                        }
                    } 
                    else if (e.state === 'reloading') {
                        e.reloadTimer++;

                        if (e.reloadTimer >= reloadDuration) {
                            e.state = 'ready';
                            e.reloadTimer = 0;
                        }
                    } 
                    else if (e.state === 'ready') {
                        e.fireTimer = 0;
                    }
                }
                // END NEW SOLDIER LOGIC

                if (e.type === 'pirate') {
                    e.cannonTimer++;
                    if (e.cannonTimer > 240 && e.target && !e.isDancing) { 
                        let angleToTarget = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                        if (Math.abs(e.angle - angleToTarget) < 1.0) { e.cannonTimer = 0; shootCannon(e); }
                    }
                }

                if (e.type === 'wizard') {
                    // FIX: Don't run out of energy if locked in a clash
                    if (e.clashTimer <= 0) e.zapTimer--;
                   // --- WIZARD SPELL CLASH LOGIC (Vs Wizard) ---
                    if (e.clashCooldown > 0) e.clashCooldown--;

                    // Only run if I am Wizard vs Wizard, ID is lower, and NO COOLDOWN
                    // OR if we are already locked in a clash (timer > 0)
                    let wizardClash = false;

                    if (e.clashCooldown <= 0 && e.target && e.target.type === 'wizard' && e.target.isZapping && e.target.target === e && e.id < e.target.id) {
                        wizardClash = true;
                    }
                    if (e.clashTimer > 0 && e.target && e.target.hp > 0 && e.target.type === 'wizard') {
                         wizardClash = true;
                    }

                    if (wizardClash) { 
                        e.clashTimer++;
                        e.target.clashTimer = e.clashTimer; // Sync timer
                        
                        // 1. Push Back
                        let angle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                        e.vx -= Math.cos(angle) * 0.2;
                        e.vy -= Math.sin(angle) * 0.2;
                        e.target.vx += Math.cos(angle) * 0.2;
                        e.target.vy += Math.sin(angle) * 0.2;

                        // 2. Sound
                        if (frameCount % 10 === 0) playSound('zap');

                        // 3. RESOLUTION (Exactly 2 Seconds)
                        if (e.clashTimer > 120) {
                            let p1Wins = Math.random() > 0.5;
                            let winner = p1Wins ? e : e.target;
                            let loser = p1Wins ? e.target : e;

                            damageEntity(loser, 60, loser.x, loser.y, winner);
                            spawnDamageText(loser.x, loser.y - 40, "OVERPOWERED!", "cyan", true);
                            spawnParticles(loser.x, loser.y, 'cyan', 30);
                            playSound('explosion');

                            loser.isZapping = false; 
                            loser.frozen = 60;
                            
                            // RESET & APPLY COOLDOWN
                            e.clashTimer = 0;
                            e.target.clashTimer = 0;
                            e.clashCooldown = 180;
                            e.target.clashCooldown = 180;
                        }
                    } 
                    // Break clash if link lost
                    else if (e.clashTimer > 0 && (!e.target || !e.target.isZapping || e.target.target !== e)) {
                        e.clashTimer = 0;
                    }
                    if (e.isZapping) {
                        e.zapCharge += 0.03; 
                        if (e.zapTimer <= 0 || !e.target || !hasLineOfSight(e, e.target)) { // Check LOS for wizard
                            e.isZapping = false; e.zapCooldown = 30; // 0.5s cooldown
                            e.zapCharge = 0;
                        } else {
                             let nearby = entities.filter(ent => ent.team !== e.team);
                             let hitCount = 0;
                             nearby.forEach(victim => {
                                 let dist = Math.sqrt((victim.x - e.x)**2 + (victim.y - e.y)**2);
                                 if (dist <= 250 && hasLineOfSight(e, victim)) { // Check LOS for wizard
                                     if (e.clashTimer <= 0) {
                                        applyZapDamage(e, victim); 
                                    }
                                     hitCount++; 
                                 }
                             });
                             if (hitCount === 0) { e.isZapping = false; e.zapCharge = 0; }
                        }
                    } else {
                        if (e.zapCooldown > 0) e.zapCooldown--;
                        if (e.zapCooldown <= 0 && e.target && !e.isDancing) {
                            let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                            if (dist <= 240 && hasLineOfSight(e, e.target)) { // Start zapping earlier only if LOS is clear
                                e.isZapping = true; e.zapTimer = 30; // 0.5s duration
                            }
                        }
                    }
                }

                if (e.type === 'knight') {
                    if (e.ramCooldown > 0) e.ramCooldown--;
                    if (e.isRamming) { e.ramTimer--; if (e.ramTimer <= 0) e.isRamming = false; } 
                    else if (e.ramCooldown <= 0 && e.target && !e.isDancing) {
                         let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                         if (dist < 150 && dist > 50) {
                             e.isRamming = true; e.ramTimer = 30; e.ramCooldown = 240; e.vx += Math.cos(e.angle) * 10; e.vy += Math.sin(e.angle) * 10;
                             spawnParticles(e.x, e.y, 'white', 5);
                         }
                    }
                }

                if (e.type === 'bow') {
                    e.timer++;
                    if (e.timer > e.fireRate && e.target && !e.isDancing) { 
                        if (hasLineOfSight(e, e.target)) {
                            // Check for Special
                            if (e.flameCooldown <= 0) {
                                e.timer = 0;
                                shootFlamingArrow(e);
                                e.flameCooldown = 240; // 4 seconds CD
                            } else {
                                e.timer = 0; 
                                shootArrow(e); 
                            }
                        }
                    }
                }

                if (e.type === 'orbiter') {
                    e.orbAngle += 0.05; e.timer++;
                    if (e.timer > 60 && e.orbCount > 0 && e.target && !e.isDancing) {
                        let d = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                        if (d < 400 && Math.abs(e.angle - Math.atan2(e.target.y-e.y, e.target.x-e.x)) < 0.5) { 
                            if (hasLineOfSight(e, e.target)) {
                                e.timer = 0; shootOrb(e); 
                            }
                        }
                    }
                    if (e.orbCount <= 0) {
                        e.type = 'unarmed'; e.mass = 1.8; e.bravery = 1.0; spawnParticles(e.x, e.y, 'gray', 10);
                    }
                }

                                              if (e.type === 'laser') {
                    const hasThreat = hasAnyLivingThreat(e);
                    const targetValid = isValidEnemyTarget(e, e.target);

// No enemies left, or current target is dead/removed/hidden.
// IMPORTANT: line of sight no longer cancels laser charging/tracking.
if (!hasThreat || !targetValid || e.isDancing) {
                        if (!hasThreat) e.target = null;
                        resetLaserState(e);
                        return;
                    }

                    if (e.blockCooldown > 0) e.blockCooldown--;

if (e.isBlocking) {
    e.blockTimer--;
    e.laserWidth = 0;
    e.state = 'blocking';

    if (e.blockTimer <= 0) {
        e.isBlocking = false;
        e.blockCooldown = 75;
        e.state = 'idle';
    }

    return;
}

const closeLaserThreat = entities.find(ent =>
    isValidEnemyTarget(e, ent) &&
    Math.sqrt((ent.x - e.x) ** 2 + (ent.y - e.y) ** 2) < 90 &&
    hasLineOfSight(e, ent)
);

if (closeLaserThreat && e.blockCooldown <= 0 && e.state !== 'firing') {
    e.angle = Math.atan2(closeLaserThreat.y - e.y, closeLaserThreat.x - e.x);
    e.isBlocking = true;
    e.blockTimer = 35;
    e.laserWidth = 0;
    e.state = 'blocking';
    spawnParticles(e.x, e.y, 'cyan', 3);
    return;
}

                    e.timer++;

                    if (e.timer === 1) {
                        let rand = Math.random();

                        const nearbyThreats = entities.filter(ent =>
                            isValidEnemyTarget(e, ent) &&
                            Math.sqrt((ent.x - e.x) ** 2 + (ent.y - e.y) ** 2) < 360
                        ).length;

                        if (nearbyThreats >= 3 && rand < 0.34) e.laserMode = 'death';
                        else if (rand < 0.62) e.laserMode = 'short';
                        else if (rand < 0.90) e.laserMode = 'medium';
                        else e.laserMode = 'death';

                        if (e.laserMode === 'short') { e.chargeTime = 30; e.fireTime = 20; }
                        if (e.laserMode === 'medium') { e.chargeTime = 105; e.fireTime = 46; }
                        if (e.laserMode === 'death') { e.chargeTime = 155; e.fireTime = 82; }

                        e.laserChargeSoundPlayed = false;
                        e.laserFireSoundPlayed = false;
                    }

                    let cycle = e.chargeTime + e.fireTime;
                    let currentTick = e.timer;

                    if (currentTick < e.chargeTime) {
                        e.state = 'charging';
                        e.laserWidth = 0;

                        if (!e.laserChargeSoundPlayed) {
                            playSound(`laser_arming_${e.laserMode}`);
                            e.laserChargeSoundPlayed = true;
                        }
                    }
                    else if (currentTick < cycle) {
                        // Re-check right before firing, because the enemy may have died during charge-up
                        const canStillFire =
    isValidEnemyTarget(e, e.target) &&
    !e.isDancing;

                        if (!canStillFire) {
                            resetLaserState(e);
                            return;
                        }

                        e.state = 'firing';

                        if (!e.laserFireSoundPlayed) {
                            playSound(e.laserMode === 'short' ? 'laser_fire_burst' : 'laser_fire_loop');
                            e.laserFireSoundPlayed = true;
                        }

                        fireLaser(e);
                    }
                    else {
                        resetLaserState(e);
                    }
                }
            });

            // Delayed Damage
            for (let i=delayedDamageEvents.length-1; i>=0; i--) {
                let ev = delayedDamageEvents[i];
                ev.timer--;
                if(ev.timer <= 0) {
                    let v = entities.find(x => x.id === ev.targetId);
                    let a = entities.find(x => x.id === ev.attackerId);
                    if(v && a) {
                        damageEntity(v, ev.damage, v.x, v.y, a);
                        spawnParticles(v.x, v.y, 'red', 20); // Blood slash
                        playSound('hit');
                    }
                    delayedDamageEvents.splice(i, 1);
                }
            }

            // Projectiles
            projectiles.forEach(p => {
                // If mine, apply drag to keep it mostly static
                if (p.isMine) {
                    p.vx *= 0.9;
                    p.vy *= 0.9;
                }

                 // --- BLACK HOLE GRAVITY (PROJECTILES) ---
        obstacles.forEach(o => {
            if (o.type === 'black_hole') {
                let dx = o.x - p.x;
                let dy = o.y - p.y;
                let dist = Math.sqrt(dx*dx + dy*dy);

                // Pull projectiles
                if (dist < 350) {
                    let force = 15 / (dist * 0.1); // Curve effect
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
                
                // Absorb projectile if it hits the center
                if (dist < o.radius) {
                    p.dead = true;
                    spawnParticles(p.x, p.y, 'purple', 3);
                }
            }
        });
        // ----------------------------------------
                

                if (p.type === 'fish') {
                    let target = p.targetId ? entities.find(en => en.id === p.targetId && en.hp > 0) : null;

                    if (!target) {
                        const enemies = entities.filter(en => en.team !== p.team && en.hp > 0 && en.type !== 'turret' && en.type !== 'boid');
                        let best = null;
                        let bestDist = Infinity;
                        enemies.forEach(en => {
                            const d = Math.sqrt((en.x - p.x)**2 + (en.y - p.y)**2);
                            if (d < bestDist) { bestDist = d; best = en; }
                        });
                        target = best;
                        if (target) p.targetId = target.id;
                    }

                    if (target) {
                        const angle = Math.atan2(target.y - p.y, target.x - p.x);
                        const speed = 8.4;
                        p.vx = p.vx * 0.75 + Math.cos(angle) * speed * 0.25;
                        p.vy = p.vy * 0.75 + Math.sin(angle) * speed * 0.25;
                    }
                }

                if (p.type === 'orb') {
                    if (!p.target || p.target.hp <= 0) {
                        let enemies = entities.filter(en => en.team !== p.team);
                        let minDist = 9999;
                        let closest = null;
                        enemies.forEach(en => {
                            let d = Math.sqrt((en.x - p.x)**2 + (en.y - p.y)**2);
                            if (d < minDist) { minDist = d; closest = en; }
                        });
                        p.target = closest;
                    }
                    if (p.target) {
                        let dx = p.target.x - p.x; let dy = p.target.y - p.y;
                        let angle = Math.atan2(dy, dx);
                        let speed = 10; p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
                    }
                }
               if (projectileTrailsEnabled && isShatterProjectile(p)) {
    if (!p.trail) p.trail = [];

    p.trail.unshift({
        x: p.x,
        y: p.y
    });

    const maxTrail = p.type === 'cannonball' ? 10 : 6;
    if (p.trail.length > maxTrail) p.trail.pop();
}

p.x += p.vx;
p.y += p.vy;
p.life--;

if (handleProjectileWallImpact(p)) return;
                
                if (p.type === 'cannonball') p.vy += 0.02;

                if ((p.type === 'potion' || p.type === 'flashbang') && p.life <= 0) {
    if (p.type === 'flashbang') explodeFlashbang(p);
    else explodePotion(p);
}});


          // 1. Update Particles
    particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    p.alpha -= 0.02;

    if (p.type === 'note') {
        p.vy -= 0.1;
    }
});

updateMuzzleFlashes();

    // 2. NEW: Update Damage Text (Move & Fade)
    damageText.forEach(t => {
        t.y += t.vy;            // Move up
        t.life--;               // Reduce life
        t.alpha = t.life / 15;  // Fade out smoothly based on remaining life
    });

    // 3. Cleanup Dead Objects
    projectiles = projectiles.filter(p => p.life > 0 && !p.dead);
    particles = particles.filter(p => p.life > 0);
    portals = portals.filter(p => p.life > 0);
    damageText = damageText.filter(t => t.life > 0); // Remove text when life hits 0

    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].hp <= 0) { 
            // Store result to see if they revived
            const result = handleDeath(entities[i]); 
            // Only remove if they did NOT revive
            if (result !== 'REVIVED') {
                entities.splice(i, 1); 
            }
        }
    }

    // --- WEAPON PICKUP LOGIC ---
    pickups = pickups.filter(p => {
        let pickedUp = false;
        
        // Check every entity
        for (let e of entities) {
            // Only Unarmed fighters (who are not currently blocking/ramming) can pick up
            if (e.type === 'unarmed' && !e.isRamming && e.hp > 0) {
                let dist = Math.sqrt((e.x - p.x)**2 + (e.y - p.y)**2);
                
                // Pickup Radius check
                if (dist < e.radius + p.radius) {
                    pickedUp = true;

                    if (GAME_MODE === 'pet') {
                        // EATING LOGIC
                        e.hunger = Math.min(e.hunger + 30, 100);
                        e.hp = e.maxHp; // Heal fully
                        spawnParticles(e.x, e.y, 'lime', 5);
                        spawnDamageText(e.x, e.y - 20, "YUM!", "#2ecc71");
                        
                        // Evolution / Growth Check
                        if (e.hunger >= 100 && e.radius < 40) {
                            e.radius += 2; // Grow bigger
                            e.mass += 0.2;
                            spawnParticles(e.x, e.y, 'gold', 10);
                        }
                    } else {
                        // NORMAL WEAPON LOGIC
                        e.heldWeaponType = p.type;
                        if (p.type === 'dagger') e.type = 'rogue';
                        else if (p.type === 'gun') { e.type = 'soldier'; e.state = 'ready'; e.fireTimer = 0; e.reloadTimer = 0; }
                        else if (p.type === 'scythe') e.type = 'scythe';
                        applyClassProps(e, e.type);
                        spawnParticles(e.x, e.y, 'gold', 15);
                        if (typeof playSound === 'function') playSound('equip');
                        spawnDamageText(e.x, e.y - 20, "EQUIPPED!", "#ffd700");
                    }
                    
                    break; 
                }
            }
        }
        return !pickedUp; // Keep weapon if NOT picked up
    });

    // --- TRAP UPDATE LOOP (Damage Over Time & Duration) ---
            traps.forEach(t => {
                // Decay unsprung traps
                if (!t.trappedEnemyId) t.life--;

                // Handle Sprung Traps
                if (t.trappedEnemyId) {
                    let victim = entities.find(e => e.id === t.trappedEnemyId);
                    
                    if (victim && victim.hp > 0) {
                        // 1. Pin them in place (Snap to trap center)
                        victim.x = t.x;
                        victim.y = t.y;
                        victim.vx = 0; 
                        victim.vy = 0;

                        // 2. Deal Damage Over Time
                        // Total 30 damage over 2 seconds (0.25 per frame)
                        let damageSource = entities.find(e => e.id === t.ownerId);
                        damageEntity(victim, 0.15, t.x, t.y, damageSource);

                        // 3. Visuals (Bleed effect)
                        if (frameCount % 20 === 0) {
                            spawnParticles(victim.x, victim.y, 'red', 3);
                            if (typeof playSound === 'function') playSound('hit');
                        }

                        // 4. Tick Duration
                        t.duration--;
                        if (t.duration <= 0) {
                            // Time's up: Release
                            t.trappedEnemyId = null;
                            t.life = 0; // Destroy the trap
                            victim.trappedBy = null;
                            victim.frozen = 0;
                            spawnParticles(t.x, t.y, '#555', 5); // Metal snap open particles
                        }
                    } else {
                        // Victim died while trapped
                        t.life = 0; // Destroy trap
                    }
                }
            });
            // Cleanup dead traps
            traps = traps.filter(t => t.life > 0);
    
            resolveCollisions();
        }

        function createPortalPair(x1, y1, x2, y2) {
            let id = Math.random();
            // Assign a unique color for the pair
            let color1 = 'cyan';
            let color2 = 'orange';
            
            portals.push({ x: x1, y: y1, id: id, link: id + 1, life: 600, angle: 0, color: color1 });
            portals.push({ x: x2, y: y2, id: id + 1, link: id, life: 600, angle: 0, color: color2 });
            playSound('portal');
        }
        function triggerHitStop(frames) { 
    if (!hitStopEnabled) return; // Exit if disabled
    hitStopTimer = frames; 
}

       function explodePotion(p) {
            playSound('explosion');
            spawnParticles(p.x, p.y, p.pType, 20);
            
            // AOE Logic
            let enemies = entities.filter(ent => ent.team !== p.team);
            enemies.forEach(en => {
                let d = Math.sqrt((en.x - p.x)**2 + (en.y - p.y)**2);
                if (d < 60) {
                    let damageSource = null;
                    if (p.shooterId) damageSource = entities.find(a => a.id === p.shooterId);

                    if(p.pType === 'green') { 
                        // Poison: 4s duration (240 frames)
                        en.poisonTimer = 240; 
                    } 
                    if(p.pType === 'purple') { 
                        en.vx *= 0.1; 
                        en.vy *= 0.1; 
                        // UPDATED: Increased slightly to 120 to ensure the combo works
                        en.frozen = 120; 
                    } 
                    
                    if(p.pType === 'orange') { 
                        // Blast Damage: 50
                        damageEntity(en, 50, en.x, en.y, damageSource); 
                        
                        // Knockback
                        let ang = Math.atan2(en.y-p.y, en.x-p.x); 
                        en.vx += Math.cos(ang)*5; 
                        en.vy += Math.sin(ang)*5; 
                    } 
                }
            });
            p.dead = true;
        }
        
        // NEW: Flaming Arrow Explosion Logic
        function explodeFlamingArrow(p) {
            playSound('explosion');
            spawnParticles(p.x, p.y, 'orange', 25);
            spawnParticles(p.x, p.y, 'red', 10);
            
            let damageSource = null;
            if (p.shooterId) damageSource = entities.find(a => a.id === p.shooterId);

            // Explosion AOE (Small but hurts)
            let enemies = entities.filter(ent => ent.team !== p.team);
            enemies.forEach(en => {
                let d = Math.sqrt((en.x - p.x)**2 + (en.y - p.y)**2);
                if (d < 50) {
                    // Instant explosion damage
                    damageEntity(en, 15, p.x, p.y, damageSource);
                    
                    // Apply Burn Status (2s duration)
                    en.burnTimer = 120;
                    en.burnSourceId = p.shooterId;
                    
                    // Knockback
                    let ang = Math.atan2(en.y - p.y, en.x - p.x);
                    en.vx += Math.cos(ang) * 5;
                    en.vy += Math.sin(ang) * 5;
                }
            });
            p.dead = true;
        }

        function damageEntity(victim, amount, impactX, impactY, damageSource) {

            if (GAME_MODE === 'pet') {
        // In Pet Mode, damage = Fun/Tickles
        if (victim.fun < 100) victim.fun += 5;
        spawnParticles(victim.x, victim.y, 'pink', 2, 'note'); // Spawn hearts/notes
        if (victim.hp < victim.maxHp) victim.hp += 1; // "Heal" on contact
        return; // STOP here, no damage dealt
    }

            if (isNaN(amount)) amount = 0;
            if (victim.type === 'rogue' && victim.isStealthed) return;
            
            // Allow friendly fire only if attacker is paranoid or in FFA
            if (damageSource && damageSource.team === victim.team && !damageSource.isParanoid && GAME_MODE !== 'ffa') return;
            // In FFA, everyone is fair game unless self (but damageSource is self in collision sometimes, so verify)
            if (damageSource && damageSource.id === victim.id) return;

            // Vampire Bat Form Invulnerability
            if (victim.type === 'vampire' && victim.isBat) return;

            // --- START SPATIAL COMBO BREAKER ---
            if (victim.type === 'spatial' && damageSource && damageSource.id !== victim.id) {
                // Initialize stress if missing
                if (!victim.stress) victim.stress = 0;
                
                // Add stress (1 hit = ~15 frames of pressure)
                victim.stress += 15;

                // Threshold: 40 frames worth of pressure
                if (victim.stress > 40) {
                    
                    // 1. Calculate Position BEHIND the Attacker
                    // Use attacker's angle to find their back
                    let backAngle = damageSource.angle + Math.PI; 
                    let teleportDist = 50; // Distance behind them
                    let targetX = damageSource.x + Math.cos(backAngle) * teleportDist;
                    let targetY = damageSource.y + Math.sin(backAngle) * teleportDist;

                    // 2. Teleport Visuals
                    spawnParticles(victim.x, victim.y, 'cyan', 15); // Disappear puff
                    playSound('zap');

                    // 3. Move Spatial
                    victim.x = targetX;
                    victim.y = targetY;
                    victim.vx = 0; 
                    victim.vy = 0;
                    victim.frozen = 0; // Break any stun
                    
                    // 4. Appear Visuals
                    spawnParticles(victim.x, victim.y, 'cyan', 15); 
                    
                    // 5. INSTANT COUNTER ATTACK (The "Hit")
                    // Deal instant damage to the attacker
                    damageEntity(damageSource, 25, damageSource.x, damageSource.y, victim);
                    spawnDamageText(damageSource.x, damageSource.y - 20, "COUNTER!", "#00ffff", true);
                    
                    // Reset Stress so it doesn't trigger infinitely
                    victim.stress = 0;
                    
                    // Log it
                    logKill('Spatial', 'Combo Breaker', victim.team, 'teleported behind', damageSource.team);

                    // Stop the current damage from hurting Spatial (he dodged it by teleporting!)
                    return; 
                }
            }
            // --- END SPATIAL COMBO BREAKER ---

            // NEW: Grabber Immunity
            // If the damage comes from a unit currently held by this Grabber, ignore it.
            // This prevents the victim from hurting the grabber to force a release.
            if (damageSource && victim.type === 'grabber' && victim.heldTargets.includes(damageSource.id)) {
                return;
            }

            // --- NEW: APPLY RAGE MULTIPLIER ---
            if (damageSource && damageSource.rageStacks > 0) {
                // 1.8x multiplier per stack (Math.pow(1.8, stacks))
                // Example: 1 stack = 1.8x, 2 stacks = 3.24x damage
                let multiplier = Math.pow(1.8, damageSource.rageStacks);
                amount *= multiplier;
            }

            // --- ADAPTO PASSIVE: TACTICAL RESILIENCE ---
if (victim.type === 'adapto' && victim.currentMode !== 'shield') {
    amount *= 0.8; // 20% Damage Reduction when not shielding
    // Optional: Visual cue for resilience (Blue spark)
    if (amount > 5) spawnParticles(victim.x, victim.y, '#0000ff', 2); 
}

// --- CONTROLLED BATTLE VARIANCE ---
// Damage is not perfectly identical every hit.
if (damageSource && damageSource.id !== victim.id) {
    const variance = damageSource.damageVariance || 0;

    amount *= randRange(1 - variance, 1 + variance);

    // Occasional bad contact / bad timing.
    // This is not a fake miss, just a weak hit.
    if (Math.random() < (damageSource.mistakeChance || 0)) {
        amount *= 0.55;
        spawnDamageText(impactX || victim.x, (impactY || victim.y) - 25, "GLANCE", "#aaa");
    }

    // Rare clutch strike when low HP.
    if (
        damageSource.hp < damageSource.maxHp * 0.28 &&
        Math.random() < (damageSource.clutchChance || 0)
    ) {
        amount *= 1.45;
        spawnDamageText(damageSource.x, damageSource.y - 28, "CLUTCH", "#ffd43b", true);
    }
}

// Dogpile pressure.
// This lets 50 weak fighters sometimes overwhelm a stronger fighter.
amount *= getSurroundedDamageMultiplier(victim);
            amount *= GLOBAL_DMG_MULT;

// Apply individual Fighter Damage Multiplier
if (damageSource && damageSource.dmgMult) {
    amount *= damageSource.dmgMult;
}

            // --- NEW: ARENA DAMAGE MODIFIER ---
    if (ARENA_THEME === 'desert') {
        amount *= 2.0; // Double Damage in Desert
        // Optional: Make text redder to show danger
        spawnParticles(victim.x, victim.y, 'orange', 2); 
    }
            
            // NEW: Record the last known killer ID
            if (damageSource) {
                victim.lastAttackerId = damageSource.id;
            } else if (impactX === 'lava') {
                 // handled in update() directly, this is just a fallback for consistency if needed
            }
            
            // Check if this damage is lethal
            if (victim.hp - amount <= 0) {
                 if (damageSource && damageSource.isMine) {
                    victim.isKilledByMine = true;
                 }
            }


            if (victim.type === 'grabber' && victim.heldTargets.length > 0) {
                victim.dropThreshold -= amount;
                if (victim.dropThreshold <= 0) {
                    victim.heldTargets.forEach(id => { let v = entities.find(e => e.id === id); if(v) { v.frozen = 0; v.heldBy = null; } });
                    victim.heldTargets = []; 
                    victim.grabCooldown = 180; // 3 seconds cooldown if forced to drop
                    victim.dropThreshold = 15; 
                    spawnParticles(victim.x, victim.y, 'brown', 10);
                }
            }

            if (damageSource && damageSource.type === 'rogue') {
                if (damageSource.isStealthed) {
                    amount *= 2.5; damageSource.isStealthed = false; damageSource.stealthCooldown = 150; 
                    spawnParticles(impactX, impactY, 'red', 10); playSound('clash');
                }
            }
            
            // Vampire Lifesteal
            if (damageSource && damageSource.type === 'vampire' && !damageSource.isBat) {
                let heal = amount;
                damageSource.hp = Math.min(damageSource.hp + heal, damageSource.maxHp);
                spawnParticles(damageSource.x, damageSource.y, 'red', 5);
                damageSource.hp = Math.min(damageSource.hp + heal, damageSource.maxHp);
                spawnDamageText(damageSource.x, damageSource.y - 10, heal, '#32cd32'); // NEW: Green number for healing
            }
            
            // --- UNARMED BLOCK LOGIC ---
            if ((victim.type === 'unarmed' || victim.type === 'laser') && victim.isBlocking && !victim.trappedBy) {
                let attackAngle = Math.atan2(impactY - victim.y, impactX - victim.x);
                let diff = Math.abs(attackAngle - victim.angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                
                // Block if hit from front (roughly 120 degree cone)
if (diff < 1.0) {
    // Roll every blocked hit: reduce damage by 10% to 100%.
    const blockReduction = 0.10 + Math.random() * 0.90;
    amount *= (1 - blockReduction);

    spawnParticles(impactX, impactY, 'gray', 3);
    spawnDamageText(
        impactX || victim.x,
        (impactY || victim.y) - 25,
        `BLOCK ${Math.round(blockReduction * 100)}%`,
        'cyan',
        blockReduction > 0.75
    );

    if (frameCount % 4 === 0) playSound('clash');
}
            }

                        if (victim.type === 'adapto' && victim.currentMode === 'shield') {
                let attackAngle = Math.atan2(impactY - victim.y, impactX - victim.x);
                let diff = Math.abs(attackAngle - victim.angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                
                // Block frontal damage
                if (diff < 1.0) {
                    amount *= 0.1; // UPDATE: 90% Damage Reduction (was 0.2)
                    spawnParticles(impactX, impactY, 'cyan', 3);
                    if (frameCount % 4 === 0) playSound('clash');
                    
                    // --- NEW: COUNTER-ATTACK TRIGGER ---
                    // If the attacker is close (Melee range), Adapto sees an opening!
                    if (damageSource) {
                        let distToAttacker = Math.sqrt((damageSource.x - victim.x)**2 + (damageSource.y - victim.y)**2);
                        if (distToAttacker < 100) {
                            // Set a timer: He will attack for the next 45 frames (0.75 seconds)
                            victim.counterTimer = 45; 
                            // Visual cue
                            spawnDamageText(victim.x, victim.y - 20, "COUNTER!", "#00ffff");
                        }
                    }
                    // -----------------------------------
                }
            }

            if (victim.type === 'orbiter' && victim.orbCount > 0 && amount > 2 && Math.random() > 0.3) {
                victim.orbCount--; spawnParticles(impactX, impactY, 'cyan', 5); playSound('clash'); return;
            }
            if (victim.type === 'knight') {
                let attackAngle = Math.atan2(impactY - victim.y, impactX - victim.x);
                let diff = Math.abs(attackAngle - victim.angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                 // Check if victim is trapped; if so, shield fails
                 if (diff < 1.0 && !victim.trappedBy) { amount *= 0.1; spawnParticles(impactX, impactY, 'gold', 5); playSound('clash'); return; }
            }

            let splatterColor = victim.color;
    if (victim.type === 'rock' || victim.type === 'spike') splatterColor = '#777'; 
    
    // Only spawn paint if damage is significant
    if (amount > 1) {
        spawnDecal(impactX || victim.x, impactY || victim.y, splatterColor);
    }

           // NEW: Visual Damage Number (Context Aware)
        let isCrit = amount > 25 || (damageSource && damageSource.type === 'rogue' && damageSource.isStealthed);
        let txtColor = isCrit ? '#ff4500' : '#ffffff'; 

        let displayLabel = amount; // Start with the amount

        // CONTEXT LOGIC:
        if (isNaN(amount)) {
            amount = 0;         
            displayLabel = "MISS"; 
            txtColor = "#888";     
        } 
        else if (amount <= 1) {
            // Damage is negligible? Probably blocked or immune.
            if (victim.isBlocking || (victim.type === 'knight') || (victim.type === 'adapto' && victim.currentMode === 'shield')) {
                displayLabel = "BLOCK"; 
                txtColor = "cyan"; 
            } 
        }

        spawnDamageText(impactX || victim.x, (impactY || victim.y) - 10, displayLabel, txtColor, isCrit);

recordDamageForRecap(damageSource, victim, amount);

victim.hp -= amount;
victim.flashTime = 5;
playSound('hit');
            if (victim.hp < 0) victim.hp = 0;
            if (amount > 10) triggerHitStop(45); // REDUCED PAUSE TO 0.75 SECONDS (45 frames)
            spawnParticles(impactX || victim.x, impactY || victim.y, 'white', 3);
            if (victim.type === 'spatial' && Math.random() > 0.6 && victim.teleportCooldown <= 0) {
                victim.x = Math.random() * canvas.width; victim.y = Math.random() * canvas.height;
                victim.teleportCooldown = 60; spawnParticles(victim.x, victim.y, 'purple', 10);
            }
        }

        function executeGodPower(pos) {
    const powerRadius = 200; // For explosion
    
    if (godPowerMode === 'lightning') {
        // Find clicked entity
        let target = null;
        let minDist = 30; // Hitbox size
        
        entities.forEach(e => {
            let d = Math.sqrt((pos.x - e.x)**2 + (pos.y - e.y)**2);
            if (d < e.radius + 10 && d < minDist) { minDist = d; target = e; }
        });

        if (target) {
            // Visuals
            spawnParticles(target.x, target.y, 'cyan', 20);
            spawnDamageText(target.x, target.y - 40, "SMITE!", "cyan", true);
            playSound('zap');
            
            // Effect: Massive Damage
            damageEntity(target, 50, target.x, target.y, null); // Null source = God damage
        }
    } 
    else if (godPowerMode === 'heal') {
        // Find clicked entity
        let target = null;
        let minDist = 30;
        
        entities.forEach(e => {
            let d = Math.sqrt((pos.x - e.x)**2 + (pos.y - e.y)**2);
            if (d < e.radius + 10 && d < minDist) { minDist = d; target = e; }
        });

        if (target) {
            // Visuals
            spawnParticles(target.x, target.y, 'lime', 20);
            spawnDamageText(target.x, target.y - 40, "+50 HP", "lime", true);
            if (typeof playSound === 'function') playSound('heal');

            // Effect: Heal
            target.hp = Math.min(target.hp + 50, target.maxHp * 1.5); // Can overheal slightly
        }
    }
    else if (godPowerMode === 'explosion') {
        // Visuals at click location
        spawnParticles(pos.x, pos.y, 'orange', 30);
        spawnParticles(pos.x, pos.y, 'red', 15);
        playSound('explosion');
        
        // Loop through all entities to apply blast
        entities.forEach(e => {
            let dx = e.x - pos.x;
            let dy = e.y - pos.y;
            let dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < powerRadius) {
                // Calculate force (closer = stronger)
                let force = (1 - dist / powerRadius) * 25; // Max force 25
                let angle = Math.atan2(dy, dx);
                
                // Apply Velocity (Knockback)
                e.vx += Math.cos(angle) * force;
                e.vy += Math.sin(angle) * force;

                // Apply Damage
                let dmg = (1 - dist / powerRadius) * 40;
                damageEntity(e, dmg, e.x, e.y, null);
                
                // Break blocks/charges
                e.isBlocking = false;
                e.frozen = 10; // Stun briefly
            }
        });
        
        // Also destroy obstacles (optional)
        obstacles.forEach(o => {
            let dist = Math.sqrt((o.x - pos.x)**2 + (o.y - pos.y)**2);
            if (dist < powerRadius && o.type !== 'lava') {
                 o.hp -= 50; // Damage rocks
                 spawnParticles(o.x, o.y, '#555', 5);
            }
        });
    }
}

        function spawnDupe(parent) {
             let parentHp = parent.maxHp;
             let d = createFighter('duplicator', parent.x, parent.y, parent.team, true, parent.isOriginal ? parent.id : parent.parentId, parentHp * 0.5);
            d.radius = parent.radius; d.generation = parent.generation + 1;
            d.vx = (Math.random()-0.5) * 15; d.vy = (Math.random()-0.5) * 15;
            entities.push(d); spawnParticles(parent.x, parent.y, parent.color, 10);
        }

        function spawnSkeleton(x, y, team, ownerId) {
    // Create a fighter manually to ensure it doesn't appear in the setup menu
    // We reuse the 'unarmed' base but override it immediately
    let skel = createFighter('skeleton', x, y, team);
    skel.type = 'skeleton'; // Force type
    applyClassProps(skel, 'skeleton');
    
    // Visuals
    skel.color = '#fff'; // Bone white
    skel.ownerId = ownerId; // Link to Necromancer
    
    entities.push(skel);
    spawnParticles(x, y, '#555', 10); // Smoke effect
    if (typeof playSound === 'function') playSound('zap');
}

        function getEntityName(e) {
            let typeName = e.type.charAt(0).toUpperCase() + e.type.slice(1);
            
            // Special case for Boids
            if (e.type === 'boid') return 'Swarm Boid';

            // Special case for Turrets (Show who owns it!)
            if (e.type === 'turret') {
                 if (e.ownerId) {
                     const owner = entities.find(o => o.id === e.ownerId);
                     // If owner exists, say "Fighter 5's Turret"
                     if (owner && owner.displayName) return `${owner.displayName}'s Turret`;
if (owner && owner.nameIndex) return `Fighter ${owner.nameIndex}'s Turret`;
                 }
                 return 'Sentry Turret';
            }

            // Special case for Duplicator Clones
            if (e.type === 'duplicator' && !e.isOriginal) {
                if (e.parentId) {
                    const parent = entities.find(p => p.id === e.parentId);
                    if (parent && parent.displayName) return `${parent.displayName}'s Dupe`;
if (parent && parent.nameIndex) return `Fighter ${parent.nameIndex}'s Dupe`;
                }
                return 'Dupe';
            }

            // --- THE NEW LOGIC ---
            // If the unit has a number, display: "Fighter 1 (Unarmed)"
            if (e.displayName) {
    return `${e.displayName} (${typeName})`;
}

if (e.nameIndex) {
    return `Fighter ${e.nameIndex} (${typeName})`;
}

            // Fallback
            return typeName;
        }

        function handleDeath(e) {
            // --- CHESS MODE: CHECKMATE ---
    if (GAME_MODE === 'chess' && e.isKing) {
        // Explode the king dramatically
        spawnParticles(e.x, e.y, 'gold', 50);
        playSound('explosion');
        
        // Declare Winner
        let winner = e.team === 1 ? "RIGHT TEAM (CHECKMATE)" : "LEFT TEAM (CHECKMATE)";
        endGame(winner);
        return; // Stop processing revival logic
    }
    // -----------------------------
            // --- FIGHT KNIGHT RESURRECTION ---
            if (e.type === 'fight knight' && e.resurrectionStage < 4) {
                e.resurrectionStage++;

                // --- NEW: RESET FEIGN ABILITY ---
                // Allow him to try healing again in this new life
                e.hasFeigned = false; 
                e.isFeigning = false;
                // --------------------------------

                // Halve Stats (Attrition)
                e.maxHp = Math.floor(e.maxHp / 2);
                
                // Halve Stats (Attrition)
                e.maxHp = Math.floor(e.maxHp / 2);
                if (e.maxHp < 5) e.maxHp = 5; // Minimum cap
                e.hp = e.maxHp;
                
                // Visuals: Armor Breaking
                playSound('explosion');
                spawnParticles(e.x, e.y, '#444', 20); 
                spawnDamageText(e.x, e.y - 40, "ARMOR BREAK!", "#ccc", true);
                
                // Explosive Knockback on Revival
                entities.forEach(other => {
                    if (other.id !== e.id && Math.sqrt((other.x - e.x)**2 + (other.y - e.y)**2) < 120) {
                        let ang = Math.atan2(other.y - e.y, other.x - e.x);
                        other.vx += Math.cos(ang) * 15;
                        other.vy += Math.sin(ang) * 15;
                    }
                });
                
                return 'REVIVED'; // Signal the loop to keep him alive
            }

            recordDeathForRecap(e);
            registerBigMoment(e.x, e.y, 'KO', 'death');

            if (e.type === 'engineer') {
                disperseEngineerTurrets(e.id);
            }

            if (e.type === 'mammoth') {
                killOwnedMammothMount(e.id);
            }

            // --- NEW: VISUAL DEATH EFFECTS ---
            let killer = entities.find(k => k.id === e.lastAttackerId);
            let isSharpKill = false;

            if (killer) {
                // Define who uses sharp weapons
                const sharpTypes = ['knight', 'pirate', 'rogue', 'samurai', 'scythe', 'lance', 'spearer', 'bard', 'trapper', 'skeleton', 'adapto', 'fight knight'];
                
                if (sharpTypes.includes(killer.type)) {
                    isSharpKill = true;
                    // Adapto only cuts if in sword mode
                    if (killer.type === 'adapto' && killer.currentMode !== 'sword') isSharpKill = false;
                }
            }

            if (isSharpKill && killer && cutInHalfEnabled) {
    // CUT IN HALF EFFECT
    spawnCorpseParts(e, killer.angle); // Spawn halves
                spawnParticles(e.x, e.y, e.color, 8); // Less clutter, just some blood
                spawnParticles(e.x, e.y, 'red', 5); // Blood spray
               playSound('slash');
            } else {
                // BLUNT / EXPLOSION EFFECT
                spawnParticles(e.x, e.y, e.color, 20); // Standard explosion
                
                // Add dust for Unarmed heavy hits
                if (killer && killer.type === 'unarmed') {
                    spawnParticles(e.x, e.y, '#ccc', 10); // Dust cloud
                }
                playSound('death');
            }
            // ---------------------------------

            // --- NECROMANCER RESURRECTION LOGIC ---

            // --- NECROMANCER RESURRECTION LOGIC ---
    // Condition: Victim is not already a skeleton, turret, or prop
    if (e.type !== 'skeleton' && e.type !== 'turret' && e.type !== 'boid' && e.type !== 'wall_trap') {
        
        let necroFound = null;

        // Priority 1: If they died while under the "Blight" effect, the caster gets the skeleton
        if (e.blightTimer > 0 && e.blightedBy) {
            let caster = entities.find(n => n.id === e.blightedBy);
            if (caster && caster.hp > 0) necroFound = caster;
        }

        // Priority 2: If no blight, check if ANY Necromancer is within range (250px)
        if (!necroFound) {
            // Find closest enemy Necromancer
            let potentialNecros = entities.filter(n => n.type === 'necromancer' && n.team !== e.team && n.hp > 0);
            let minDist = 250;
            
            potentialNecros.forEach(n => {
                let d = Math.sqrt((n.x - e.x)**2 + (n.y - e.y)**2);
                if (d < minDist) {
                    minDist = d;
                    necroFound = n;
                }
            });
        }

        // If we found a valid Necromancer, raise the dead!
        if (necroFound) {
            spawnSkeleton(e.x, e.y, necroFound.team, necroFound.id);
            // Optional: Visual text
            spawnDamageText(e.x, e.y - 30, "ARISE!", "#00ff00", true);
        }
    }
    // --- END NECROMANCER LOGIC ---

            if (e.heldWeaponType) {
                pickups.push({
                    x: e.x, 
                    y: e.y,
                    type: e.heldWeaponType,
                    radius: 15,
                    angle: Math.random() * Math.PI * 2
                });
                // Optional: Show text to indicate the drop
                spawnDamageText(e.x, e.y - 30, "DROPPED!", "#ffd700");
            }
            
            const victimName = getEntityName(e);
            const victimTeam = e.team;
            let killerName = 'The Environment'; 
            let killerTeam = 0; // 0 for environment
            let verbPhrase = 'was destroyed by'; 

            if (e.lastAttackerId) {
                if (e.lastAttackerId === 'poison') {
                    killerName = 'Poison';
                    verbPhrase = 'succumbed to';
                    killerTeam = 0; 
                } else if (e.lastAttackerId === 'lava') {
                    killerName = 'Lava';
                    verbPhrase = 'melted in';
                    killerTeam = 0;
                } else if (e.lastAttackerId === 'spike') {
                     killerName = 'Spikes';
                     verbPhrase = 'was impaled on';
                     killerTeam = 0;
                } else {
                    let killer = entities.find(ent => ent.id === e.lastAttackerId);
                    if (killer) {
                        killerName = getEntityName(killer);
                        killerTeam = killer.team; 
                        
                        // Default combat phrase
                        verbPhrase = 'was defeated by the'; 

                        // Determine the specific verb phrase
                        if (killer.type === 'turret') {
                            const owner = entities.find(o => o.id === killer.ownerId);
                            killerName = (owner ? getEntityName(owner) : 'Sentry') + ' Turret';
                            verbPhrase = 'was shot by the';
                        } 
                        else if (killer.type === 'lance') {
                            verbPhrase = 'was impaled by the';
                        }
                        else if (killer.type === 'scythe') {
                            verbPhrase = 'was decimated by the';
                        }
                        else if (killer.type === 'knight') {
                            if (killer.isRamming) {
                                verbPhrase = 'was crushed by the Ram of the';
                            } else {
                                verbPhrase = 'was struck by the shield of the';
                            }
                        }
                        else if (killer.type === 'rogue') {
                            verbPhrase = 'was cut down by the';
                        }
                        else if (killer.type === 'devourer') {
                             verbPhrase = 'was devoured by the';
                        }
                        else if (killer.type === 'pirate') {
                            verbPhrase = 'was cut down by the';
                        }
                        else if (killer.type === 'soldier') {
                            verbPhrase = 'was riddled with bullets from the';
                        }
                        else if (killer.type === 'wizard') {
                            verbPhrase = 'was electrocuted by the';
                        }
                        else if (killer.type === 'bow') {
                            // NEW: Differentiate arrow vs fire
                            if (e.burnTimer > 0) verbPhrase = 'was incinerated by the';
                            else verbPhrase = 'was pierced by the arrows of the';
                        }
                        else if (killer.type === 'laser') {
                            verbPhrase = 'was vaporized by the';
                        }
                        else if (killer.type === 'grabber') {
                            // FIX: Grabber kills are caused by wall slams, tracked inside update() logic
                            verbPhrase = 'was slammed into a wall by the';
                        }
                        else if (killer.type === 'bard') {
                             verbPhrase = 'was hit by the sonic boom of the';
                        }
                        else if (killer.type === 'orbiter') {
                            verbPhrase = 'was disintegrated by the orbiters of the';
                        }
                        else if (killer.type === 'samurai') {
                             verbPhrase = 'was cut down by the Iaijutsu Dash of the';
                        }
                        else if (killer.type === 'alchemist') {
                            verbPhrase = 'was caught in the blast of the';
                        }
                        else if (killer.type === 'boid') {
                             verbPhrase = 'was consumed by the Swarm of the';
                        }
                        else if (killer.type === 'trapper') {
                            // FIX: Differentiate mine vs dagger kill using the flag set before lethal damage
                            if (e.isKilledByMine) {
                                verbPhrase = 'was vaporized by a mine from the';
                            } else {
                                verbPhrase = 'was stabbed by the';
                            }
                        }
                        else if (killer.type === 'spatial') {
                            verbPhrase = 'was slammed into oblivion by the';
                        }
                        else if (killer.type === 'whispers') {
                             verbPhrase = 'was driven insane by the';
                        }
                        else if (killer.type === 'grower') {
                             verbPhrase = 'was smashed by the growing mass of the';
                        }
                        else if (killer.type === 'unarmed') {
                             // SPECIAL KILL MSG FOR UNARMED
                             if (e.lastPushedBy === killer.id) {
                                 verbPhrase = 'was thrown into a hazard by the';
                             } else {
                                 verbPhrase = 'was pummeled by the';
                             }
                        }
                        else if (killer.team === e.team) {
                            // Friendly Fire
                             if (killer.type === 'duplicator') {
                                 verbPhrase = 'was sacrificed by a glitching';
                             } else if (killer.isParanoid) {
                                 verbPhrase = 'was betrayed by the paranoid';
                             } else {
                                verbPhrase = 'was eliminated by a friendly';
                             }
                        }
                        // Generic melee/push collision kill uses default 'defeated by the'
                    }
                }
            } else if (e.type === 'devourer' && e.hp <= 0 && e.maxHp > 0) {
                killerName = 'Starvation';
                verbPhrase = 'succumbed to';
                killerTeam = 0; 
            } else if (e.type === 'turret' && e.hp <= 0 && e.maxHp > 0) {
                 killerName = 'Battery Drain';
                 verbPhrase = 'expired due to';
                 killerTeam = 0; 
            } else {
                 // Fallback for environmental damage or general collapse
                 killerName = 'The Environment';
                 verbPhrase = 'was destroyed by';
                 killerTeam = 0; 
            }
            
            // Cleanup: Remove 'the' if the killer isn't a named fighter/entity (e.g., Poison, Starvation)
            if (killerTeam === 0) {
                verbPhrase = verbPhrase.replace(' by the', ' by').replace(' to the', ' to');
            }
            
            if (GAME_MODE === 'clan' && e.lastAttackerId) {
    const killer = entities.find(k => k.id === e.lastAttackerId);
    
    // Only proceed if there was a valid killer and teams are different
    if (killer && killer.team !== e.team) {
        
        // 1. RAGE EFFECT (Victim's Teammates)
        // "If a teammate dies, other members become enraged"
        entities.forEach(ally => {
            if (ally.team === e.team && ally.id !== e.id) {
                ally.rageStacks++;
                ally.rageTargetId = killer.id; // Prioritize the killer
                
                // Visual Effect: Turn Red
                spawnParticles(ally.x, ally.y, 'red', 10);
                spawnDamageText(ally.x, ally.y - 30, "RAGE!", "#ff0000", true);
            }
        });

        // 2. PRIDE EFFECT (Killer's Team)
        // "Killer's team received a pride effect which increases their health"
        entities.forEach(ally => {
            if (ally.team === killer.team) {
                ally.prideStacks++;
                
                // Increase Max HP by 1.6x (Stacking)
                ally.maxHp *= 1.6;
                // Heal them proportionally so they get the benefit immediately
                ally.hp *= 1.6; 
                
                // Visual Effect: Turn Gold
                spawnParticles(ally.x, ally.y, 'gold', 10);
                spawnDamageText(ally.x, ally.y - 30, "PRIDE!", "#FFD700", true);
            }
        });
    }
}
            
            // Pass the victim's team to logKill for correct coloring
            logKill(killerName, victimName, killerTeam, verbPhrase, victimTeam);

            // --- RECAP KILL TRACKER ---
recordKillForRecap(e);
// --- END RECAP KILL TRACKER ---

            if (e.type === 'duplicator' && e.isOriginal) {
                entities.forEach(other => {
                    if (other.parentId === e.id) {
                        other.hp = 0; 
                        spawnParticles(other.x, other.y, 'black', 10);
                    }
                });
            }
            if (e.type === 'grabber') {
                e.heldTargets.forEach(id => {
                    let victim = entities.find(v => v.id === id);
                    if (victim) { victim.frozen = 0; victim.heldBy = null; }
                });
            }
            // Ensure any trapped entity is released
            traps.forEach(t => {
                if (t.trappedEnemyId === e.id) {
                    t.trappedEnemyId = null;
                    t.life = 0;
                }
            });
        }

               function endGame(text) {
    gameOverTriggered = true;
    playBGM('menu');

    if (isTournamentMatch && tournamentData.active) {
        let winnerTeamNum = text.includes("LEFT") ? 1 : (text.includes("RIGHT") ? 2 : 0);
        
        if (winnerTeamNum === 0) {
            // Draw? Random coin flip or sudden death
            winnerTeamNum = Math.random() > 0.5 ? 1 : 2; 
            text += " (Coin Flip used for Tourney)";
        }

        let currentRound = tournamentData.matches[tournamentData.round];
        let match = currentRound[tournamentData.currentMatchIndex];
        
        // Assign Winner
        match.winner = (winnerTeamNum === 1) ? match.p1 : match.p2;
        
        // Save
        saveTournament();
        
        // Wait 3 seconds then return to bracket
        setTimeout(() => {
            isTournamentMatch = false;
            isSetupPhase = true;
            resetCamera(); // Reset cam
            document.getElementById('mainTitle').innerHTML = '<span style="color:gold">TOURNAMENT BRACKET</span>';
        }, 3000);
    }
    
    const mvp = getMvpStat();

if (mvp && mvp.kills > 0) {
    saveHighscore(mvp.name, mvp.kills);
}

const finalResultText = text;

// Hide any old modal first, then show recap after a short dramatic pause.
resultModal.style.display = 'none';

if (modalTimeout) {
    clearTimeout(modalTimeout);
    modalTimeout = null;
}

setTimeout(() => {
    // If the player already reset/started setup, don't show old recap.
    if (!gameOverTriggered) return;

    resultText.innerText = finalResultText;

    if (finalResultText.includes("LEFT")) resultText.style.color = "#00c3ff";
    else if (finalResultText.includes("RIGHT")) resultText.style.color = "#d62626"; 
    else resultText.style.color = "#ffffff"; 

    const msgContainer = document.getElementById('msgContainer');

    if (msgContainer) {
        msgContainer.innerHTML = buildBattleRecapHTML();
    }

    const playBtn = document.getElementById('playAgainBtn');
    if (playBtn) playBtn.style.display = 'inline-block';

    resultModal.style.display = 'block';
}, 2000);
}

        function applyPhysics(e) {
            if (isSetupPhase) return; // NEW: Skip physics in setup mode
            if (e.type === 'turret') return; // Fixed
            if (entities.some(g => g.type === 'grabber' && g.heldTargets.includes(e.id))) { e.vx = 0; e.vy = 0; return; }
            if (e.frozen > 0 && !e.grappledBy) { e.vx = 0; e.vy = 0; return; } // Allow velocity if grappled (pulled)
            e.vy += GRAVITY; e.x += e.vx; e.y += e.vy; e.vx *= FRICTION; e.vy *= FRICTION;

            let currentFriction = FRICTION; // Default 0.98

   if (ARENA_THEME === 'mud') {
        // Lower number = velocity dies instantly (Thick Sludge)
        currentFriction = 0.65; 
    } else if (ARENA_THEME === 'snow') {
        // Closer to 1.0 = velocity barely decreases (Pure Ice)
        currentFriction = 0.999; 
    }

    e.vx *= currentFriction; 
    e.vy *= currentFriction;

            // --- BLACK HOLE GRAVITY (ENTITIES) ---
    obstacles.forEach(o => {
        if (o.type === 'black_hole') {
            let dx = o.x - e.x;
            let dy = o.y - e.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            // 1. Gravity Pull Range (400px)
            if (dist < 400 && dist > 10) {
                // Stronger pull the closer you get
                let force = 60 / dist; 
                e.vx += (dx / dist) * force;
                e.vy += (dy / dist) * force;
            }

            // 2. Event Horizon (Damage/Death if touching center)
            if (dist < o.radius) {
                damageEntity(e, 999, o.x, o.y, null); // Instant Kill
                spawnParticles(e.x, e.y, 'purple', 10);
            }
        }
    });
    // -------------------------------------

            // NEW: Check for Ice
    let onIce = false;
    for (let o of obstacles) {
        if (o.type === 'ice') {
            let dist = Math.sqrt((e.x - o.x)**2 + (e.y - o.y)**2);
            // If overlapping with ice (radius + unit radius), they are sliding
            if (dist < o.radius + e.radius - 5) {
                onIce = true;
                break;
            }
        }
    }

    if (onIce) {
        // ICE PHYSICS: Almost zero friction (0.999)
        e.vx *= 0.999; 
        e.vy *= 0.999;
        
        // Optional: Add tiny random slip to make standing still hard
        if (Math.abs(e.vx) < 0.1 && Math.abs(e.vy) < 0.1) {
             e.vx += (Math.random()-0.5)*0.2;
             e.vy += (Math.random()-0.5)*0.2;
        }
    } else {
        // STANDARD PHYSICS
        e.vx *= FRICTION; 
        e.vy *= FRICTION;
    }
}


        function handleWalls(e) {
            if (e.y + e.radius > canvas.height) { e.y = canvas.height - e.radius; e.vy *= -WALL_BOUNCE; }
            if (e.y - e.radius < 0) { e.y = e.radius; e.vy *= -WALL_BOUNCE; }
            if (e.x + e.radius > canvas.width) { e.x = canvas.width - e.radius; e.vx *= -WALL_BOUNCE; }
            if (e.x - e.radius < 0) { e.x = e.radius; e.vx *= -WALL_BOUNCE; }
        }

        function applyAI(e) {

            if (e.type === 'binder') {
    // 1. Check on Owner
    let owner = entities.find(ent => ent.id === e.ownerId);
    if (!owner || owner.hp <= 0) {
        e.hp = 0; // Die if owner dies
        spawnParticles(e.x, e.y, 'grey', 5);
        return;
    }

    // 2. Binding Logic (Active Hold)
    if (e.boundTargetId) {
        let victim = entities.find(v => v.id === e.boundTargetId);
        
        if (victim && victim.hp > 0 && e.bindTimer > 0) {
            // Stick to victim
            e.x = victim.x + Math.cos(frameCount * 0.2) * 15;
            e.y = victim.y + Math.sin(frameCount * 0.2) * 15;
            e.vx = 0; e.vy = 0;
            
            // FREEZE VICTIM
            victim.vx = 0; victim.vy = 0; 
            victim.frozen = 5; // Keep refreshing freeze
            
            // DoT (Damage over Time)
            if (frameCount % 15 === 0) {
                damageEntity(victim, 2, e.x, e.y, e);
                spawnParticles(victim.x, victim.y, 'red', 3);
            }
            
            e.bindTimer--;
            return; // Skip movement while binding
        } else {
            // Release
            e.boundTargetId = null;
            e.bindCooldown = 120; // 2 seconds cooldown
        }
    }

    // 3. Movement / Chase Logic
    if (e.bindCooldown > 0) e.bindCooldown--;

    // Find target
    let enemies = entities.filter(ent => ent.team !== e.team && !ent.isStealthed && ent.hp > 0);
    let nearest = null, minD = 9999;
    
    enemies.forEach(en => {
        let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
        if (d < minD) { minD = d; nearest = en; }
    });

    // If target found and ready to bite
    if (nearest && minD < 400 && e.bindCooldown <= 0) {
        let ang = Math.atan2(nearest.y - e.y, nearest.x - e.x);
        e.vx += Math.cos(ang) * 0.6; // Fast chase
        e.vy += Math.sin(ang) * 0.6;
        
        // Bite Trigger
        if (minD < nearest.radius + e.radius + 5) {
            e.boundTargetId = nearest.id;
            e.bindTimer = 180; // Hold for 3 seconds
            playSound('hit');
            spawnDamageText(nearest.x, nearest.y - 30, "BOUND!", "orange", true);
        }
    } else {
        // Return to Owner
        let distToOwner = Math.sqrt((owner.x - e.x)**2 + (owner.y - e.y)**2);
        if (distToOwner > 60) {
            let ang = Math.atan2(owner.y - e.y, owner.x - e.x);
            e.vx += Math.cos(ang) * 0.5;
            e.vy += Math.sin(ang) * 0.5;
        }
    }
    
    // Friction
    e.vx *= 0.9; e.vy *= 0.9;
    return; // Stop standard AI
}

            if (GAME_MODE === 'pet') {
        applyPetAI(e);
        return; // Skip all normal combat AI
    }

            // Guard against AI execution during setup phase
            if (isSetupPhase) return; 

            if (e.clashTimer > 0) return;

            let moveSpeed = 0.3; 
    let action = 'chase';
            
            // --- BOIDS AI (SWARM) ---
            if (e.type === 'boid') {
                const separationDist = 20;
                const alignDist = 60;
                const cohesionDist = 60;
                const enemyDist = 200;
                
                let sepX=0, sepY=0;
                let aliX=0, aliY=0;
                let cohX=0, cohY=0;
                let attX=0, attY=0;
                
                let neighbors = 0;
                
                // Scan entities
                entities.forEach(other => {
                    if (other === e) return;
                    let d = Math.sqrt((other.x - e.x)**2 + (other.y - e.y)**2);
                    
                    // Flocking with friends
                    if (other.type === 'boid' && other.team === e.team) {
                        if (d < separationDist) {
                            sepX += (e.x - other.x) / d;
                            sepY += (e.y - other.y) / d;
                        }
                        if (d < alignDist) {
                            aliX += other.vx;
                            aliY += other.vy;
                        }
                        if (d < cohesionDist) {
                            cohX += other.x;
                            cohY += other.y;
                            neighbors++;
                        }
                    } 
                    // Attack Enemies
                    else if (other.team !== e.team && !other.isStealthed) {
                        if (d < enemyDist) {
                            attX += (other.x - e.x);
                            attY += (other.y - e.y);
                        }
                    }
                });
                
                if (neighbors > 0) {
                    aliX /= neighbors; aliY /= neighbors;
                    cohX = (cohX / neighbors) - e.x;
                    cohY = (cohY / neighbors) - e.y;
                }
                
                // Normalize and weight forces
                // 1. Separation (Avoid crowding)
                e.vx += sepX * 0.5; e.vy += sepY * 0.5;
                
                // 2. Alignment (Move together)
                e.vx += aliX * 0.05; e.vy += aliY * 0.05;
                
                // 3. Cohesion (Stay close)
                // cohX/Y is the vector pointing TO the center of the flock
                e.vx += cohX * 0.01; 
                e.vy += cohY * 0.01;
                
                // 4. Attack OR Idle Formation
                let attMag = Math.sqrt(attX*attX + attY*attY);
                
                if (attMag > 0) {
                    // ATTACK MODE: Chase enemies
                    e.vx += (attX / attMag) * 0.4;
                    e.vy += (attY / attMag) * 0.4;
                } else {
                    // IDLE MODE: Orbit the center (New)
                    // We use the Cohesion vector (which points to center) to calculate a tangent
                    // Tangent is (-y, x)
                    if (neighbors > 0) {
                        let orbitForce = 0.05;
                        // Push perpendicular to the center direction to create rotation
                        e.vx += -cohY * orbitForce; 
                        e.vy += cohX * orbitForce;
                    }
                }
                
                // Cap speed
                let speed = Math.sqrt(e.vx*e.vx + e.vy*e.vy);
                const maxSpeed = 4.0;
                if (speed > maxSpeed) {
                    e.vx = (e.vx / speed) * maxSpeed;
                    e.vy = (e.vy / speed) * maxSpeed;
                }
                
                // Random jitter for "organic" feel
                e.vx += (Math.random()-0.5) * 0.2;
                e.vy += (Math.random()-0.5) * 0.2;
                
                e.angle = Math.atan2(e.vy, e.vx);
                return;
            }
            // --- END BOIDS AI ---

            // --- SPATIAL ESCAPE & COUNTER (NEW) ---
            if (e.type === 'spatial' && (e.trappedBy || e.heldBy) && e.teleportCooldown <= 0) {
                 let aggressorId = e.trappedBy || e.heldBy;
                 let aggressor = entities.find(a => a.id === aggressorId);

                 if (aggressor) {
                     // 1. Teleport Logic (Flank the aggressor)
                     // Teleport to a random position near the aggressor to confuse them
                     let angle = Math.random() * Math.PI * 2;
                     e.x = aggressor.x + Math.cos(angle) * 80; 
                     e.y = aggressor.y + Math.sin(angle) * 80;
                     
                     // 2. Clear Status
                     e.frozen = 0;
                     e.vx = 0; e.vy = 0;
                     
                     // Break Trap
                     if (e.trappedBy) {
                         let trap = traps.find(t => t.trappedEnemyId === e.id);
                         if (trap) { trap.trappedEnemyId = null; trap.life = 0; }
                         e.trappedBy = null;
                     }
                     
                     // Break Grab
                     if (e.heldBy) {
                         if (aggressor.heldTargets) {
                             aggressor.heldTargets = aggressor.heldTargets.filter(id => id !== e.id);
                         }
                         e.heldBy = null;
                     }

                     // 3. Counter Attack (Instant Slam Setup)
                     e.slamTarget = aggressor.id;
                     e.slamTimer = 120; // 2s window to execute slam
                     e.teleportCooldown = 240; // 4s Cooldown
                     
                     // Visuals
                     spawnParticles(e.x, e.y, 'cyan', 15);
                     playSound('zap');
                     
                     // Log the escape
                     logKill('Spatial Teleport', 'Escape', e.team, 'evaded capture by', aggressor.team);
                     
                     return; // Action taken, skip rest of AI this frame
                 }
            }
            // --- END SPATIAL ESCAPE ---

            if (e.frozen > 0 && !e.grappledBy) return; // Allow AI thoughts if just being pulled, though movement is forced
            if (entities.some(g => g.type === 'grabber' && g.heldTargets.includes(e.id))) return;
            if (e.type === 'whispers' && e.isControlling) return;
            
            // DANCE LOGIC (STUN)
            if (e.isDancing) {
                e.vx += (Math.random()-0.5)*0.5; // Jiggle
                e.vy += (Math.random()-0.5)*0.5;
                return; // Stop processing AI
            }
            
            // GRABBER HOOK LOGIC
            // Added check for grabCooldown <= 0 so he can't hook during cooldown
            if (e.type === 'grabber' && e.heldTargets.length < 2 && e.grabCooldown <= 0) {
                 if (e.hookCooldown > 0) e.hookCooldown--;
                 // Look for hook targets
                 let enemies = entities.filter(ent => ent.team !== e.team && !ent.isStealthed && !ent.heldBy && !ent.grappledBy);
                 
                 // Simple check for closest valid target
                 let bestTarget = null;
                 let minDist = 250; // Max Range
                 
                 enemies.forEach(en => {
                     let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
                     if (d < minDist && d > 50) { // Min range to avoid hooking melee range foes
                         // Check LOS
                         if (hasLineOfSight(e, en)) {
                             minDist = d;
                             bestTarget = en;
                         }
                     }
                 });
                 
                 if (bestTarget && e.hookCooldown <= 0) {
                     shootHook(e, bestTarget);
                     e.hookCooldown = 240; // Increased cooldown to 4 seconds (Nerf)
                     return; // Action taken
                 }
            }

            // Vampire in bat form is purely evasive
            if (e.type === 'vampire' && e.isBat) {
                // Find nearest enemy to flee from
                let enemies = entities.filter(ent => ent.team !== e.team);
                let nearest = null; let minD = 9999;
                enemies.forEach(en => {
                    let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
                    if(d < minD) { minD = d; nearest = en; }
                });
                
                if (nearest) {
                    let angle = Math.atan2(nearest.y - e.y, nearest.x - e.x);
                    e.vx -= Math.cos(angle) * 0.5; // Flee fast
                    e.vy -= Math.sin(angle) * 0.5;
                    e.angle = angle + Math.PI; // Face away
                } else {
                    e.vx += (Math.random()-0.5);
                    e.vy += (Math.random()-0.5);
                }
                return;
            }

            if (e.type === 'turret') {
                // Turret AI: Find nearest target, aim at it
                let enemies = entities.filter(ent => ent.team !== e.team && !ent.isStealthed && ent.hp > 0);
                
                // Paranoia Check for Turret
                if (e.isParanoid) {
                     enemies = entities.filter(ent => ent.id !== e.id && ent.hp > 0);
                }

                let nearest = null; let minD = 9999;
                enemies.forEach(en => {
                    let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
                    if(d < minD) { minD = d; nearest = en; }
                });
                
                if (nearest && minD < 400) { // Range
                    e.target = nearest;
                    let targetAngle = Math.atan2(nearest.y - e.y, nearest.x - e.x);
                    // Slow rotation
                    let diff = targetAngle - e.angle;
                    while (diff < -Math.PI) diff += Math.PI*2; while (diff > Math.PI) diff -= Math.PI*2; 
                    e.angle += diff * 0.1;
                } else {
                    e.angle += 0.05; // Idle spin
                    e.target = null;
                }
                return;
            }

            if (e.type === 'grabber' && e.heldTargets.length > 0) {
                let dLeft = e.x; let dRight = canvas.width - e.x; let dTop = e.y; let dBot = canvas.height - e.y;
                let min = Math.min(dLeft, dRight, dTop, dBot);
                let speed = 2.0; 
                if (min === dLeft) e.vx -= speed; else if (min === dRight) e.vx += speed;
                else if (min === dTop) e.vy -= speed; else e.vy += speed;
                e.angle += 0.2; return; 
            }
if (e.type === 'duplicator') {
                // --- SHARED BLOCKING MECHANICS ---
                if (e.isBlocking) {
                    e.blockTimer--;
                    if (e.blockTimer <= 0) { e.isBlocking = false; e.blockCooldown = 120; }
                    moveSpeed = 0.05; // Slow while blocking
                }
                if (e.blockCooldown > 0) e.blockCooldown--;

                if (e.isOriginal) {
                    // ============================================
                    // KING AI: KITE, HIDE, AND SPAWN
                    // ============================================

                    // 1. Spawning Logic (Keep existing)
                    e.dupeTimer++;
                    let maxDupes = 12;
                    let myClones = entities.filter(t => t.parentId === e.id);
                    
                    // Spawn if under limit and not stunned
                    if (e.dupeTimer > 60 && myClones.length < maxDupes && !e.isDancing) {
                         // Initial cooldown wait
                         if (e.generation === 1 && e.dupeTimer < 120) { 
                             // Just wait
                         } else {
                             e.dupeTimer = 0; 
                             spawnDupe(e);
                         }
                    }

                    // 2. Kiting Logic (Avoid Enemies)
                    let nearestThreat = null; 
                    let minThreatDist = 9999;
                    
                    // Scan for closest enemy
                    let threats = entities.filter(ent => ent.team !== e.team && !ent.isStealthed);
                    threats.forEach(t => {
                        let d = Math.sqrt((t.x - e.x)**2 + (t.y - e.y)**2);
                        if (d < minThreatDist) { minThreatDist = d; nearestThreat = t; }
                    });

                    const safetyRadius = 400; // King wants to be this far away

                    if (nearestThreat && minThreatDist < safetyRadius) {
                        // RUN AWAY!
                        let angleToThreat = Math.atan2(nearestThreat.y - e.y, nearestThreat.x - e.x);
                        // Move directly away from threat
                        e.vx -= Math.cos(angleToThreat) * 0.55; 
                        e.vy -= Math.sin(angleToThreat) * 0.55;
                        
                        // Face the threat to block if necessary (though he prefers running)
                        e.angle = angleToThreat; 
                        
                        // Emergency Block: If cornered or hit recently
                        if (minThreatDist < 100 && e.blockCooldown <= 0 && !e.isBlocking) {
                            e.isBlocking = true;
                            e.blockTimer = 60;
                        }
                    } else {
                        // Safe? Wander slowly to stay mobile
                        e.vx += (Math.random()-0.5)*0.2;
                        e.vy += (Math.random()-0.5)*0.2;
                    }
                    
                    // Keep within map bounds to prevent getting stuck
                    if(e.x < 50) e.vx += 0.5;
                    if(e.x > canvas.width - 50) e.vx -= 0.5;
                    if(e.y < 50) e.vy += 0.5;
                    if(e.y > canvas.height - 50) e.vy -= 0.5;

                    return; // RETURN EARLY: King never engages in standard combat/chase

                } else {
                    // ============================================
                    // CLONE AI: ATTACK OR PROTECT
                    // ============================================
                    let king = entities.find(k => k.id === e.parentId);
                    
                    // If King is dead, clones go fight knight (standard AI)
                    if (!king) {
                        e.bravery = 1.0; 
                        // Fall through to standard AI at bottom of function
                    } else {
                        // Get all siblings
                        let siblings = entities.filter(ent => ent.parentId === king.id);
                        let totalClones = siblings.length;

                        // LOGIC: If > 4 Clones, Top 2 HP protect, rest attack.
                        // If <= 4 Clones, everyone attacks.
                        
                        let isBodyguard = false;

                        if (totalClones >= 4) {
                            // Sort siblings by HP (High to Low)
                            siblings.sort((a, b) => b.hp - a.hp);
                            
                            // Check if 'this' clone is index 0 or 1 (Top 2)
                            if (siblings.indexOf(e) < 2) {
                                isBodyguard = true;
                            }
                        }

                        if (isBodyguard) {
                            // --- BODYGUARD BEHAVIOR ---
                            
                            // 1. Stay close to King
                            let distToKing = Math.sqrt((king.x - e.x)**2 + (king.y - e.y)**2);
                            let guardDist = 60;

                            if (distToKing > guardDist) {
                                let angleToKing = Math.atan2(king.y - e.y, king.x - e.x);
                                e.vx += Math.cos(angleToKing) * 0.6;
                                e.vy += Math.sin(angleToKing) * 0.6;
                                e.angle = angleToKing; // Look where going
                            } else {
                                // Orbit slightly
                                e.vx += (Math.random()-0.5)*0.2;
                                e.vy += (Math.random()-0.5)*0.2;
                            }

                            // 2. Block Logic (Human Shield)
                            // Is there a projectile or enemy near the king?
                            let danger = entities.find(ent => ent.team !== e.team && Math.sqrt((ent.x - king.x)**2 + (ent.y - king.y)**2) < 200);
                            
                            if (danger) {
                                // Face the danger
                                e.angle = Math.atan2(danger.y - e.y, danger.x - e.x);
                                
                                // Block if off cooldown
                                if (!e.isBlocking && e.blockCooldown <= 0) {
                                    e.isBlocking = true;
                                    e.blockTimer = 60;
                                }
                            }

                            return; // Skip standard AI

                        } else {
                            // --- ATTACKER BEHAVIOR ---
                            e.bravery = 1.0; // Max aggression
                            e.isFrenzied = true; // Flag as frenzy to ignore some self-preservation
                            // Fall through to standard "chase" AI below
                        }
                    }
                }
            }
            
            // TARGET SELECTION LOGIC
            let enemies;
            if (e.isParanoid) {
                // PARANOIA: Prioritize own teammates for chaos!
                let teammates = entities.filter(other => other.team === e.team && other.id !== e.id && !other.isStealthed);
                if (teammates.length > 0) enemies = teammates;
                else enemies = entities.filter(other => other.id !== e.id && !other.isStealthed); // Anyone
            } else {
                enemies = entities.filter(other => other.team !== e.team && !other.isStealthed && !other.isFeigning && other.hp > 0);
            }
            
            if (enemies.length === 0) {
    e.target = null;

    if (e.type === 'laser') {
        resetLaserState(e);
    }

    return;
}

            let target;
            
            
            // TRAPPER TARGETING: Prioritize attacking trapped enemies!
            if (e.type === 'trapper') {
                let trappedTarget = enemies.find(f => f.trappedBy === e.id);
                if (trappedTarget) {
                    target = trappedTarget;
                } else {
                    // Normal targeting (closest or strongest)
                    if (Math.random() > 0.95) target = enemies[Math.floor(Math.random() * enemies.length)]; 
                    else {
                        let minDist = 9999;
                        enemies.forEach(en => {
                            let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
                            if (d < minDist) { minDist = d; target = en; }
                        });
                    }
                }
            } 
            // General Targeting
            else if (e.type === 'knight' || e.realType === 'chameleon') {
                target = enemies.sort((a,b) => b.hp - a.hp)[0];
            } else {
                if (Math.random() > 0.95) target = enemies[Math.floor(Math.random() * enemies.length)]; 
                    else {
                    let minDist = 9999;
                    enemies.forEach(en => {
                        let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
                        if (d < minDist) { minDist = d; target = en; }
                    });
                }
            }
            
            if (!e.target || Math.random() > 0.9) e.target = target; 
            target = e.target;

            // --- NEW: RAGE TARGET OVERRIDE ---
// If we are enraged and have a specific vendetta target
if (e.rageStacks > 0 && e.rageTargetId) {
    const vendettaTarget = entities.find(v => v.id === e.rageTargetId && v.hp > 0);
    if (vendettaTarget && !vendettaTarget.isStealthed) {
        // Force the target to be the killer
        e.target = vendettaTarget;
        
        // Skip standard selection logic
        // We add a 'return' check or just ensure the next block doesn't overwrite e.target
    } else {
        // Killer is dead or gone, clear the vendetta
        e.rageTargetId = null;
    }
}
// ---------------------------------

if (enemies.length === 0) {
    e.target = null;

    if (e.type === 'laser') {
        resetLaserState(e);
    }

    return;
}

// Only run standard targeting if we didn't just lock onto a vendetta target
if (!e.target || (e.target.id !== e.rageTargetId)) {
    // ... Existing logic for Trapper, Knight, closest distance, etc ...
    // Copy your existing logic here, or just wrap the existing logic in an "if (!e.target)" check
}

            let dx = target.x - e.x; let dy = target.y - e.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            // Default aiming (at the target)
            let targetAngle = Math.atan2(dy, dx);

            // --- UPDATE: PREDICTIVE AIMING FOR ADAPTO ---
            if (e.type === 'adapto' && e.currentMode === 'gun') {
                const bulletSpeed = 15; // Must match your bullet speed
                const timeToHit = dist / bulletSpeed;
                
                // Predict where target will be
                const predX = target.x + (target.vx * timeToHit);
                const predY = target.y + (target.vy * timeToHit);
                
                // Aim at the future position
                targetAngle = Math.atan2(predY - e.y, predX - e.x);
            }
            // ---------------------------------------------

            if (e.type === 'adapto') {
    const targetBlocked = e.target && !hasLineOfSight(e, e.target);
    const usableBarrel = findAdaptoShootableBarrel(e);

    // NEW: ASSESSMENT BEHAVIOR
    if (e.currentMode === 'assess') {
        moveSpeed = 0.6;

        if (targetBlocked) {
            action = 'strafe';
        }
        else if (dist < 320) action = 'flee';
        else if (dist > 460) action = 'chase';
        else action = 'strafe';
    }

    // DEFENSIVE BEHAVIOR
    else if (e.currentMode === 'shield') {
        moveSpeed = 0.18;

        // Shield mode now tries to back toward cover instead of standing still
        if (dist < 260) action = 'flee';
        else action = 'strafe';
    }

    // GUN / ENVIRONMENT BEHAVIOR
    else if (e.currentMode === 'gun') {
        moveSpeed = 0.5;

        // If he sees a useful barrel, keep spacing and angle for the shot
        if (usableBarrel) {
            action = 'strafe';
        }
        else if (targetBlocked) {
            action = 'strafe';
        }
        else if (dist < 230) action = 'flee';
        else if (dist > 390) action = 'chase';
        else action = 'strafe';
    }

    // SWORD MODE
    else {
        moveSpeed = 0.55;

        // Don't blindly sword-rush through bad terrain
        if (targetBlocked && dist > 100) action = 'strafe';
        else action = 'chase';
    }
}
            // --- SMART BARREL TARGETING (NEW) ---
            // Applies to: Soldier, Pirate, Bow, Adapto (Gun Mode)
            e.overrideShootTarget = null;
            if (e.target && (e.type === 'soldier' || e.type === 'pirate' || e.type === 'bow' || (e.type === 'adapto' && e.currentMode === 'gun'))) {

                let nearbyBarrel = null;

                if (e.type === 'soldier') {
                    nearbyBarrel = findSoldierShootableBarrel(e);
                } else {
                    // Look for a barrel near the ENEMY
                    nearbyBarrel = obstacles.find(o => 
                        o.type === 'barrel' && 
                        o.hp > 0 &&
                        Math.sqrt((o.x - e.target.x)**2 + (o.y - e.target.y)**2) < 180 &&
                        hasLineOfSight(e, o)
                    );
                }

                if (nearbyBarrel) {
                    // Override aim: Shoot the barrel instead of the enemy
                    e.overrideShootTarget = nearbyBarrel;
                    targetAngle = Math.atan2(nearbyBarrel.y - e.y, nearbyBarrel.x - e.x);

                    if (frameCount % 60 === 0) spawnDamageText(e.x, e.y - 30, "BARREL!", "#ffff00"); 
                }
            }

            // Apply general angle update (used by most non-unique fighters and soldiers)
            // --- CHESS MODE: RESTRICTED MOVEMENT VECTORS ---
            if (GAME_MODE === 'chess') {
                // 1. ROOK (Laser): Orthogonal Movement Only (Up/Down/Left/Right)
                if (e.type === 'laser') {
                    // Check if angle is closer to Horizontal or Vertical
                    if (Math.abs(Math.cos(targetAngle)) > Math.abs(Math.sin(targetAngle))) {
                        // Snap to Left or Right (0 or PI)
                        targetAngle = (Math.cos(targetAngle) > 0) ? 0 : Math.PI; 
                    } else {
                        // Snap to Up or Down (PI/2 or -PI/2)
                        targetAngle = (Math.sin(targetAngle) > 0) ? Math.PI/2 : -Math.PI/2; 
                    }
                }
                
                // 2. BISHOP (Wizard): Diagonal Movement Only
                else if (e.type === 'wizard') {
                    // Determine which Quadrant the target is in
                    let xDir = Math.cos(targetAngle) > 0 ? 1 : -1;
                    let yDir = Math.sin(targetAngle) > 0 ? 1 : -1;
                    // Force exact 45-degree angles (PI/4, 3PI/4, etc.)
                    targetAngle = Math.atan2(yDir, xDir); 
                }
                
                // 3. PAWN (Unarmed): Forward Movement Only
                else if (e.type === 'unarmed') {
                    // Team 1 moves Right (0), Team 2 moves Left (PI)
                    let forward = e.team === 1 ? 0 : Math.PI;
                    
                    // Check difference between "Target Direction" and "Forward"
                    let diff = Math.abs(targetAngle - forward);
                    while (diff > Math.PI) diff = 2*Math.PI - diff; // Normalize
                    
                    // If target is behind us (>90 degrees), DO NOT MOVE.
                    // Pawns cannot retreat.
                    if (diff > 1.5) { 
                        moveSpeed = 0; 
                    }
                }
                
                // 4. KNIGHT (Knight): "Hop" Movement
                else if (e.type === 'knight') {
                    // Instead of walking, Knights jump periodically
                    moveSpeed = 0; // Disable standard walking
                    
                    // Every ~1 second (60 frames), do a burst of speed
                    if (frameCount % 60 === 0) {
                        e.vx = Math.cos(targetAngle) * 15; // JUMP!
                        e.vy = Math.sin(targetAngle) * 15;
                        spawnParticles(e.x, e.y, 'white', 5); // Dust effect
                    }
                }
            }
            // -----------------------------------------------
            let diff = targetAngle - e.angle;
            while (diff < -Math.PI) diff += Math.PI*2; while (diff > Math.PI) diff -= Math.PI*2; 
            // Adapto gets super-fast turning in Gun mode to snap to targets
            let turnSpeed = (e.type === 'adapto' && e.currentMode === 'gun') ? 0.3 : 0.15;
            e.angle += diff * turnSpeed;

            // START ENGINEER AI OVERRIDE
            if (e.type === 'engineer') {
                const safeDistance = 400; // Stay well back
                let nearest = null;
                let minD = 9999;
                
                // Scan for nearest enemy to maintain distance
                let threats = entities.filter(ent => ent.team !== e.team && !ent.isStealthed);
                threats.forEach(t => {
                    let d = Math.sqrt((t.x - e.x)**2 + (t.y - e.y)**2);
                    if (d < minD) { minD = d; nearest = t; }
                });

                // Dodge Projectiles (Basic)
                let nearbyProj = projectiles.find(p => p.team !== e.team && Math.sqrt((p.x-e.x)**2 + (p.y-e.y)**2) < 100);
                if (nearbyProj) {
                     let angle = Math.atan2(nearbyProj.vy, nearbyProj.vx);
                     let dodgeDir = angle + Math.PI/2;
                     e.vx += Math.cos(dodgeDir) * 0.8;
                     e.vy += Math.sin(dodgeDir) * 0.8;
                }

                if (nearest && minD < safeDistance) {
                    // Run away!
                    let angleToThreat = Math.atan2(nearest.y - e.y, nearest.x - e.x);
                    e.vx -= Math.cos(angleToThreat) * 0.4;
                    e.vy -= Math.sin(angleToThreat) * 0.4;
                } else {
                    // Safe? Just wander slightly or stop to "focus" on turrets
                    e.vx += (Math.random()-0.5)*0.2;
                    e.vy += (Math.random()-0.5)*0.2;
                }

                // Keep within bounds (softly)
                if(e.x < 40) e.vx += 0.2;
                if(e.x > canvas.width - 40) e.vx -= 0.2;
                if(e.y < 40) e.vy += 0.2;
                if(e.y > canvas.height - 40) e.vy -= 0.2;

                return; // Done
            }
            // END ENGINEER AI OVERRIDE

           // --- RANGED TACTICS (SOLDIER/BOW/WIZARD/ORBITER/LASER/ALCHEMIST) ---
            // 1. Add 'alchemist' to this list so the AI knows to use ranged logic
           const isRanged = ['soldier', 'bow', 'wizard', 'orbiter', 'engineer', 'laser', 'alchemist', 'necromancer', 'aquamarine'].includes(e.type);

            if (isRanged && e.target) {
                const isBlocked = !hasLineOfSight(e, e.target);
                
                // 2. Define the preferred distance for the Alchemist (250 is good for lobbing potions)
                const optimalRange = e.type === 'soldier' ? 300 : 
                                   (e.type === 'bow' ? 300 : 
                                   (e.type === 'laser' ? 250 : 
                                   (e.type === 'alchemist' ? 250 : 200))); // Added Alchemist here

                // ... (The rest of the logic remains the same) ...

                // 1. Evasive Movement (when projectiles are incoming)
                let dodging = false;
                let nearestProjectile = projectiles.find(p => p.team !== e.team && Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2) < 120);

                if (nearestProjectile) { 
                    // Try to dodge or move to cover
                    
                    let closestCover = null;
                    let minCoverDist = 9999;
                    obstacles.forEach(o => {
                        const d = Math.sqrt((o.x - e.x)**2 + (o.y - e.y)**2);
                        if (d < minCoverDist) { minCoverDist = d; closestCover = o; }
                    });

                    if (closestCover && !isBlocked) {
                        // If target is visible, use lateral dodge
                         let pAngle = Math.atan2(nearestProjectile.vy, nearestProjectile.vx); 
                         let dodgeAngle = pAngle + Math.PI/2 * (Math.random() > 0.5 ? 1 : -1);
                         e.vx += Math.cos(dodgeAngle) * 0.8; e.vy += Math.sin(dodgeAngle) * 0.8;
                         action = 'dodge';
                    } else if (closestCover) {
                         // If LOS is blocked or no projectile, move toward cover for safety
                         const coverAngle = Math.atan2(closestCover.y - e.y, closestCover.x - e.x);
                         e.vx += Math.cos(coverAngle) * 0.8; 
                         e.vy += Math.sin(coverAngle) * 0.8;
                         action = 'flee';
                    } else {
                         // Simple scatter dodge
                         e.vx += (Math.random() - 0.5) * 0.8;
                         e.vy += (Math.random() - 0.5) * 0.8;
                         action = 'dodge';
                    }
                }
                
                // 2. Line of Sight Management (if not dodging)
                if (!dodging && isBlocked) {
                    // Move around the obstacle to clear LOS. Pick a flanking direction (perpendicular to target line).
                    let flankAngle = targetAngle + (e.team === 1 ? Math.PI/2 : -Math.PI/2);
                    e.vx += Math.cos(flankAngle) * moveSpeed;
                    e.vy += Math.sin(flankAngle) * moveSpeed;
                    return; // AI decision made
                }

                // 3. Ranged Spacing (if LOS is clear or target is unreachable)
                if (!dodging && e.type !== 'engineer') {
                    if (dist < optimalRange - 50) action = 'flee'; 
                    else if (dist > optimalRange + 50) action = 'chase'; 
                    else action = 'strafe'; 
                }
            } 
            // --- END RANGED TACTICS ---

            // necromancer ai

            if (e.type === 'necromancer') {
                e.blightCooldown--;

                if (e.isBlighting) {
                        // Stop blighting if target lost/dead or out of LOS
                        if (e.blightCooldown <= 0 || !e.target || !hasLineOfSight(e, e.target) || e.target.hp <= 0) {
                            e.isBlighting = false; 
                            e.blightCooldown = 60; // 1s cooldown
                            e.clashTimer = 0; 
                        } else {
                            // --- SPELL CLASH LOGIC (Necromancer) ---
                            // 1. Cooldown Management
                            if (e.clashCooldown > 0) e.clashCooldown--;

                            let isClashing = false;
                            
                            // Only check for new clash if not cooling down
                            if (e.clashCooldown <= 0) {
                                // Case A: VS Wizard (I am Necro, Target is Wizard)
                                if (e.target.type === 'wizard' && e.target.isZapping && e.target.target === e) {
                                    isClashing = true;
                                }
                                // Case B: VS Necromancer (Lower ID handles calculation)
                                else if (e.target.type === 'necromancer' && e.target.isBlighting && e.target.target === e && e.id < e.target.id) {
                                    isClashing = true;
                                }
                            }

                            // If we are already mid-clash (timer > 0), force isClashing to true to finish it
                            if (e.clashTimer > 0 && e.target && e.target.hp > 0) {
                                isClashing = true;
                            }

                            if (isClashing) {
                                e.clashTimer++;
                                e.target.clashTimer = e.clashTimer; // Sync Target
                                e.blightCooldown = 120; // Keep Blight active

                                // 1. Push Back (Physics)
                                let angle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                                let pushForce = 0.2;
                                e.vx -= Math.cos(angle) * pushForce;
                                e.vy -= Math.sin(angle) * pushForce;
                                e.target.vx += Math.cos(angle) * pushForce;
                                e.target.vy += Math.sin(angle) * pushForce;

                                // 2. Sound
                                if (frameCount % 10 === 0) playSound('zap');

                                // 3. RESOLUTION (Exactly 2 Seconds / 120 Frames)
                                if (e.clashTimer > 120) {
                                    let myWin = Math.random() > 0.5;
                                    let winner = myWin ? e : e.target;
                                    let loser = myWin ? e.target : e;
                                    
                                    // Apply Results
                                    damageEntity(loser, 60, loser.x, loser.y, winner);
                                    spawnDamageText(loser.x, loser.y - 40, "OVERPOWERED!", "#ff0000", true);
                                    spawnParticles(loser.x, loser.y, '#ff4500', 30);
                                    playSound('explosion');
                                    
                                    // Stun Loser
                                    if (loser.type === 'wizard') loser.isZapping = false;
                                    if (loser.type === 'necromancer') loser.isBlighting = false;
                                    loser.frozen = 60;

                                    // RESET & APPLY COOLDOWN (3 Seconds)
                                    e.clashTimer = 0;
                                    e.target.clashTimer = 0;
                                    e.clashCooldown = 180;        // 3 Seconds for me
                                    e.target.clashCooldown = 180; // 3 Seconds for them
                                }
                            } else {
                                // NORMAL BLIGHT (No Clash)
                                e.clashTimer = 0; 
                                if (frameCount % 4 === 0) {
                                    e.target.blightTimer = 180; 
                                    e.target.blightedBy = e.id; 
                                    let dmg = 0.2;
                                    damageEntity(e.target, dmg, e.target.x, e.target.y, e);
                                    if (e.hp < e.maxHp) e.hp = Math.min(e.hp + dmg, e.maxHp);
                                    if (typeof playSound === 'function') playSound('zap');
                                }
                            }
                        }
                    } else {
                    // Attempt to start Blighting
                    if (e.blightCooldown <= 0 && e.target && !e.isDancing) {
                        let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                        // Slightly shorter range than Wizard (220)
                        if (dist <= 220 && hasLineOfSight(e, e.target)) {
                            e.isBlighting = true; 
                            e.blightCooldown = 120; // Channel for 2 seconds
                        }
                    }
                }
            }

              // START TRAPPER AI OVERRIDE - V6 (Strict Flanking & Defensive Layering)
            if (e.type === 'trapper') {
                // Initialize cooldowns if missing
                if (typeof e.wallCooldown === 'undefined') e.wallCooldown = 0;
                if (e.wallCooldown > 0) e.wallCooldown--;

                const directionalFoes = ['knight', 'lance', 'scythe', 'pirate', 'soldier', 'bow', 'wizard', 'rogue', 'samurai'];
                let dodging = false;
                let dodgeVx = 0, dodgeVy = 0;

                // --- 1. PRECOGNITION (Dodge Projectiles) ---
                // (Keep existing projectile dodge logic, it's solid)
                let incoming = projectiles.filter(p => p.team !== e.team && Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2) < 200);
                incoming.forEach(p => {
                    let relVx = p.vx - e.vx;
                    let relVy = p.vy - e.vy;
                    let t = -((e.x - p.x)*relVx + (e.y - p.y)*relVy) / (relVx*relVx + relVy*relVy);
                    if (t > 0 && t < 40) {
                        let futureDist = Math.sqrt(((p.x + p.vx * t) - (e.x + e.vx * t))**2 + ((p.y + p.vy * t) - (e.y + e.vy * t))**2);
                        if (futureDist < e.radius + 15) {
                            let pAngle = Math.atan2(p.vy, p.vx);
                            let dir = (Math.atan2(e.y - p.y, e.x - p.x) > pAngle) ? 1 : -1;
                            dodgeVx += Math.cos(pAngle + Math.PI/2 * dir) * 1.5;
                            dodgeVy += Math.sin(pAngle + Math.PI/2 * dir) * 1.5;
                            dodging = true;
                        }
                    }
                });
                if (dodging) { e.vx += dodgeVx; e.vy += dodgeVy; return; }

                // --- 2. AGGRO RESPONSE (Traps & Walls) ---
                if (e.target) {
                    let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                    let angleToEnemy = Math.atan2(e.target.y - e.y, e.target.x - e.x);

                    // Check Aggro: Is enemy moving towards us?
                    let enemySpeed = Math.sqrt(e.target.vx**2 + e.target.vy**2);
                    let approachFactor = 0;
                    if (enemySpeed > 0.5) {
                        let angleToMe = Math.atan2(e.y - e.target.y, e.x - e.target.x);
                        let enemyAngle = Math.atan2(e.target.vy, e.target.vx);
                        approachFactor = Math.cos(angleToMe - enemyAngle);
                    }

                    // Condition: Enemy is approaching fast OR is very close
                    let isRushing = (dist < 250 && approachFactor > 0.7) || (dist < 150);
                    
                    // Check if target is already dealt with
                    const targetTrapped = (e.target.trappedBy === e.id || e.target.trapped || e.target.frozen > 0);

                    if (isRushing && !targetTrapped) {
                        // PRIORITY 1: BEAR TRAP (The "Bait")
                        // Drop directly between Trapper and Enemy
                        let myActiveTraps = traps.filter(t => t.ownerId === e.id && !t.isMine).length;
                        
                        if (e.trapCooldown <= 0 && myActiveTraps < e.maxTraps) {
                             let trapX = e.x + Math.cos(angleToEnemy) * 40;
                             let trapY = e.y + Math.sin(angleToEnemy) * 40;
                             
                             const trapSpot = dropTrapForTrapper(e, trapX, trapY, angleToEnemy);
                             if (trapSpot) {
                                 e.trapCooldown = 60; // Short cooldown for defensive drop

                                 // Backstep
                                 e.vx -= Math.cos(angleToEnemy) * 2.0;
                                 e.vy -= Math.sin(angleToEnemy) * 2.0;

                                 playSound('clash');
                                 spawnParticles(trapSpot.x, trapSpot.y, 'cyan', 5);
                                 return;
                             } 
                        }

                        // PRIORITY 2: WALL TRAP (The "Stop")
                        if (e.wallCooldown <= 0) {
                            let wallX = e.x + Math.cos(angleToEnemy) * 35; 
                            let wallY = e.y + Math.sin(angleToEnemy) * 35;

                            obstacles.push({
                                x: wallX, y: wallY,
                                type: 'wall_trap', radius: 20, mass: 1000, 
                                hp: 1, maxHp: 1, life: 999
                            });

                            e.wallCooldown = 300; 
                            playSound('clash');
                            spawnParticles(wallX, wallY, '#8B4513', 10);

                            // Flank immediately
                            let flankDir = Math.random() > 0.5 ? 1 : -1;
                            e.vx += Math.cos(angleToEnemy + Math.PI/2 * flankDir) * 5.0; 
                            e.vy += Math.sin(angleToEnemy + Math.PI/2 * flankDir) * 5.0;
                            return;
                        }

                        // PRIORITY 3: MINES (The "Retreat")
                        if (e.mineCooldown <= 0) {
                             const mineSpot = dropMineForTrapper(e, e.x - Math.cos(angleToEnemy) * 28, e.y - Math.sin(angleToEnemy) * 28, angleToEnemy + Math.PI);
                             if (mineSpot) {
                                 e.mineCooldown = 60;
                             }
                        }

                        // PRIORITY 4: PANIC DODGE (All cooldowns down)
                        if (dist < 120) {
                             // Dodge perpendicular to threat
                             let flankDir = Math.random() > 0.5 ? 1 : -1;
                             e.vx += Math.cos(angleToEnemy + Math.PI/2 * flankDir) * 3.0;
                             e.vy += Math.sin(angleToEnemy + Math.PI/2 * flankDir) * 3.0;
                             return;
                        }
                    }

                    // --- 3. OFFENSIVE / TACTICAL MOVEMENT ---
                    let hasAdvantage = targetTrapped || (e.target.hp < e.target.maxHp * 0.3);

                    if (hasAdvantage) {
                        // SMART FLANKING ATTACK
                        let destX = e.target.x;
                        let destY = e.target.y;
                        
                        // STRICT FLANKING RULE for Directional Foes
                        if (directionalFoes.includes(e.target.type)) {
                            let backAngle = e.target.angle + Math.PI;
                            destX = e.target.x + Math.cos(backAngle) * 40;
                            destY = e.target.y + Math.sin(backAngle) * 40;
                        }

                        let moveAngle = Math.atan2(destY - e.y, destX - e.x);
                        let distToDest = Math.sqrt((destX - e.x)**2 + (destY - e.y)**2);

                        // If not at flank position yet, MOVE THERE. Do not attack.
                        if (distToDest > 20) {
                            e.vx += Math.cos(moveAngle) * 0.6; // Sprint to flank
                            e.vy += Math.sin(moveAngle) * 0.6;
                        } else {
                            // Only attack if effectively behind/side OR target is stunned/trapped
                            // Angle check: Are we facing their back?
                            let angleToMe = Math.atan2(e.y - e.target.y, e.x - e.target.x);
                            let diff = Math.abs(angleToMe - e.target.angle);
                            while (diff > Math.PI) diff -= Math.PI*2;
                            while (diff < -Math.PI) diff += Math.PI*2;
                             
                            // Safe to hit if: Trapped OR Behind (>90 deg) OR Not a directional foe
                            if (targetTrapped || Math.abs(diff) > 1.5 || !directionalFoes.includes(e.target.type)) {
                                 e.vx *= 0.5; e.vy *= 0.5; // Stabilize
                                 if (frameCount % 10 === 0) damageEntity(e.target, 5, e.x, e.y, e);
                            } else {
                                // Still in front? Keep circling!
                                e.vx += Math.cos(moveAngle + Math.PI/2) * 1.0;
                                e.vy += Math.sin(moveAngle + Math.PI/2) * 1.0;
                            }
                        }
                    } else {
                        // STANDARD KITING (If no advantage)
                        // (Maintain distance and drop predictive traps)
                        let myActiveTraps = traps.filter(t => t.ownerId === e.id && !t.isMine).length;
                        if (e.trapCooldown <= 0 && myActiveTraps < e.maxTraps) {
                             // Predictive Trap Logic (Same as before)
                             const leadTime = 50; 
                             const predX = e.target.x + (e.target.vx * leadTime);
                             const predY = e.target.y + (e.target.vy * leadTime);
                             const predDist = Math.sqrt((predX - e.x)**2 + (predY - e.y)**2);
                             if (Math.sqrt(e.target.vx**2 + e.target.vy**2) > 0.5 && predDist < 500 && predDist > 100) {
                                 const trapSpot = dropTrapForTrapper(e, predX, predY, Math.atan2(e.target.vy, e.target.vx));
                                 if (trapSpot) {
                                     e.trapCooldown = 100; 
                                     spawnParticles(trapSpot.x, trapSpot.y, 'cyan', 3);
                                 }
                             }
                        }

                        let optimalDist = 250;
                        let targetAngle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                        if (dist < optimalDist) {
                            e.vx -= Math.cos(targetAngle) * 0.45;
                            e.vy -= Math.sin(targetAngle) * 0.45;
                        } else if (dist > optimalDist + 200) {
                            e.vx += Math.cos(targetAngle) * 0.25;
                            e.vy += Math.sin(targetAngle) * 0.25;
                        } else {
                            e.vx += Math.cos(targetAngle + Math.PI/2) * 0.35;
                            e.vy += Math.sin(targetAngle + Math.PI/2) * 0.35;
                        }
                    }
                } else {
                    e.vx += (Math.random() - 0.5) * 0.2; e.vy += (Math.random() - 0.5) * 0.2;
                }
            }
            // END TRAPPER AI OVERRIDE

            // START fight knight AI
            if (e.type === 'fight knight') {
                // Initialize "Once per fight" flag
                if (typeof e.hasFeigned === 'undefined') e.hasFeigned = false;
                
                e.cleaveCooldown = 0; e.ramCooldown = 0; e.feignCooldown = 0;
                if (typeof e.spinTimer === 'undefined') e.spinTimer = 0;

                // --- 1. TRIGGER "TACTICAL RETREAT" ---
                if (e.hp < e.maxHp * 0.35 && !e.isFeigning && !e.hasFeigned) {
                    e.isFeigning = true; 
                    e.bravery = 0; // Run away!
                    e.target = null;
                    
                    // Force enemies to lose interest
                    entities.forEach(ent => {
                        if (ent.target === e) ent.target = null;
                    });

                    spawnParticles(e.x, e.y, '#555', 15);
                    spawnDamageText(e.x, e.y - 30, "RETREAT!", "#fff");
                }

                // --- 2. WHILE FEIGNING (Retreat & Heal) ---
                if (e.isFeigning) {
                    // A. Rapid Regeneration
                    e.hp += 0.5; 
                    if (frameCount % 10 === 0) spawnParticles(e.x, e.y, 'lime', 1);

                    // B. Find Safest Corner logic
                    let threats = entities.filter(ent => ent.team !== e.team && ent.hp > 0);
                    let avgX = canvas.width / 2; let avgY = canvas.height / 2;
                    if (threats.length > 0) {
                        let sumX = 0, sumY = 0;
                        threats.forEach(t => { sumX += t.x; sumY += t.y; });
                        avgX = sumX / threats.length; avgY = sumY / threats.length;
                    }
                    const corners = [
                        {x: 50, y: 50}, {x: canvas.width - 50, y: 50},
                        {x: 50, y: canvas.height - 50}, {x: canvas.width - 50, y: canvas.height - 50}
                    ];
                    let bestDest = corners[0]; let maxDist = -1;
                    corners.forEach(c => {
                        let d = Math.sqrt((c.x - avgX)**2 + (c.y - avgY)**2);
                        if (d > maxDist) { maxDist = d; bestDest = c; }
                    });

                    // Move to corner
                    let angle = Math.atan2(bestDest.y - e.y, bestDest.x - e.x);
                    e.vx += Math.cos(angle) * 0.6; 
                    e.vy += Math.sin(angle) * 0.6;
                    e.angle = angle;

                    // C. WAKE UP CONDITION (Full HP + ARMOR)
                    if (e.hp >= e.maxHp) {
                        // 1. Apply Armor Buff (Increase Max HP and fill it)
                        e.maxHp += 40; 
                        e.hp = e.maxHp;
                        
                        // 2. Reset State
                        e.isFeigning = false;
                        e.hasFeigned = true; 
                        e.bravery = 1.0; // Ready to fight
                        
                        // 3. Visuals (Cyan for Armor, Red for Rage)
                        spawnParticles(e.x, e.y, 'cyan', 20); 
                        spawnParticles(e.x, e.y, 'red', 20);
                        playSound('explosion');
                        spawnDamageText(e.x, e.y - 40, "ARMOR UP!", "#00ffff", true);
                    }
                    return; 
                }

                // --- 3. COMBAT LOGIC ---
                if (e.target) {
                    let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                    // Ram Attack
                    if (dist > 100 && dist < 300 && hasLineOfSight(e, e.target) && !e.isRamming && e.spinTimer <= 0) {
                        e.isRamming = true; e.chargeTimer = 60; e.angle = Math.atan2(e.target.y - e.y, e.target.x - e.x); 
                        playSound('clash'); spawnParticles(e.x, e.y, '#333', 10);
                    }
                    // Spin Attack
                    if (dist < 120 && !e.isRamming) { e.spinTimer = 40; }
                }

                if (e.isRamming) {
                    e.chargeTimer--; e.vx += Math.cos(e.angle) * 2.0; e.vy += Math.sin(e.angle) * 2.0;
                    if (e.chargeTimer <= 0) e.isRamming = false;
                }
                if (e.spinTimer > 0) {
                    e.spinTimer--; e.angle += 0.8; action = 'stop';
                }
            }
            // END fight knight AI

      // START SOLDIER AI OVERRIDE FOR MOVEMENT
            if (e.type === 'soldier' || e.type === 'dualist') {
                moveSpeed = 0.4;
                const optimalDist = 300; 
                const angleDiff = Math.abs(diff);
                const isBlocked = !hasLineOfSight(e, target);
                
                // --- 1. WALL AVOIDANCE FORCE (The "Anti-Stuck" Logic) ---
                let wallPushX = 0; 
                let wallPushY = 0;
                const margin = 80; // Distance to start reacting to walls (Increased)
                
                // Check X boundaries
                if (e.x < margin) wallPushX = 1; // Push Right
                else if (e.x > canvas.width - margin) wallPushX = -1; // Push Left
                
                // Check Y boundaries
                if (e.y < margin) wallPushY = 1; // Push Down
                else if (e.y > canvas.height - margin) wallPushY = -1; // Push Up

                // Is he in a corner? (Both X and Y need pushing)
                const inCorner = (wallPushX !== 0 && wallPushY !== 0);

                // --- 2. STRAFE DIRECTION LOGIC ---
                // strafeDir: 1 = Right, -1 = Left
                if (!e.strafeDir) e.strafeDir = 1; 
                if (!e.strafeTimer) e.strafeTimer = 0;
                
                e.strafeTimer--;
                if (e.strafeTimer <= 0) {
                    e.strafeDir = Math.random() > 0.5 ? 1 : -1;
                    e.strafeTimer = 60 + Math.random() * 60; 
                }

                // PREDICTION: If we strafe this way, do we hit a wall?
                let sideAngle = targetAngle + (Math.PI/2 * e.strafeDir);
                let nextX = e.x + Math.cos(sideAngle) * 40;
                let nextY = e.y + Math.sin(sideAngle) * 40;
                
                // If the next step hits a wall, FLIP direction immediately
                if (nextX < margin || nextX > canvas.width - margin || nextY < margin || nextY > canvas.height - margin) {
                    e.strafeDir *= -1; 
                    e.strafeTimer = 30; // Commit to the flip
                }

                // --- 3. HAZARD AVOIDANCE (Lava/Mines) ---
                let avoidX = 0; let avoidY = 0; let nearHazard = false;
                obstacles.forEach(o => {
                    if (o.type === 'lava' || o.type === 'spike') {
                        let d = Math.sqrt((o.x - e.x)**2 + (o.y - e.y)**2);
                        if (d < 150) { 
                            nearHazard = true; avoidX += (e.x - o.x) / d; avoidY += (e.y - o.y) / d;
                        }
                    }
                });
                projectiles.forEach(p => {
                    if (p.isMine) {
                        let d = Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2);
                        if (d < 130) {
                            nearHazard = true; avoidX += (e.x - p.x) / d; avoidY += (e.y - p.y) / d;
                        }
                    }
                });
                if (nearHazard) { e.vx += avoidX * 0.8; e.vy += avoidY * 0.8; }
                
                // --- 4. MOVEMENT STATE MACHINE ---
                if (e.state === 'firing') {
                    // Just slow down, don't stop completely, so walls can still push us
                    e.vx *= 0.8; e.vy *= 0.8; 
                } 
                else if (e.state === 'reloading') {
                    moveSpeed = 0.6;
                    // If near a wall, use the wall push instead of normal strafing
                    if (wallPushX !== 0 || wallPushY !== 0) {
                        e.vx += wallPushX * moveSpeed;
                        e.vy += wallPushY * moveSpeed;
                    } else {
                        // Normal strafe
                        e.vx += Math.cos(targetAngle + Math.PI/2 * e.strafeDir) * moveSpeed; 
                        e.vy += Math.sin(targetAngle + Math.PI/2 * e.strafeDir) * moveSpeed;
                    }
                } 
                else if (e.state === 'ready') {
                    if (angleDiff < 0.2) { e.state = 'firing'; e.fireTimer = 1; return; }
                    
                    if (isBlocked) {
                         // Flank around obstacles
                         let flankAngle = targetAngle + (Math.PI/2 * e.strafeDir);
                         e.vx += Math.cos(flankAngle) * moveSpeed * 0.8;
                         e.vy += Math.sin(flankAngle) * moveSpeed * 0.8;
                    } 
                    else if (dist > optimalDist) {
                        // Chase
                        e.vx += Math.cos(targetAngle) * moveSpeed; 
                        e.vy += Math.sin(targetAngle) * moveSpeed;
                    } 
                    else if (dist < optimalDist - 50) {
                        // RETREAT LOGIC
                        // CRITICAL FIX: Only retreat if NOT cornered. 
                        if (!inCorner) {
                            e.vx -= Math.cos(targetAngle) * moveSpeed * 0.5;
                            e.vy -= Math.sin(targetAngle) * moveSpeed * 0.5;
                            // Mix in strafe so we don't back up in a straight line
                            e.vx += Math.cos(targetAngle + Math.PI/2 * e.strafeDir) * moveSpeed * 0.3;
                            e.vy += Math.sin(targetAngle + Math.PI/2 * e.strafeDir) * moveSpeed * 0.3;
                        } else {
                            // If cornered, DO NOT back up. Move sideways/center only.
                            e.vx += wallPushX * moveSpeed;
                            e.vy += wallPushY * moveSpeed;
                        }
                    } 
                    
                }
                
                // --- 5. FINAL SAFETY PUSH ---
                // Apply the wall push on top of everything else.
                // This guarantees he slides off the wall even if the AI wants to go into it.
                if (wallPushX !== 0 || wallPushY !== 0) {
                    e.vx += wallPushX * 0.4;
                    e.vy += wallPushY * 0.4;
                }

                if (!e.target) { e.vx += (canvas.width/2 - e.x) * 0.05; e.vy += (canvas.height/2 - e.y) * 0.05; }
                return; 
            }
            // END NEW SOLDIER AI OVERRIDE
            
            // START UNARMED AI OVERRIDE (WEAPON SEEKER + ENVIRONMENTAL BRAWLER)
            if (e.type === 'unarmed' || e.type === 'chameleon' || e.type === 'grower' || e.type === 'regenerator' || e.type === 'chrono') {

                if (e.type === 'regenerator' && e.hp < e.maxHp * 0.5) {
                    
                    if (e.target) {
                        let dist = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);
                        
                        // Condition A: Enemy is close? TURTLE UP.
                        // We block to mitigate damage while the passive regen ticks.
                        if (dist < 180) {
                            e.isBlocking = true;
                            e.blockTimer = 5; // Refresh block constantly
                            moveSpeed = 0.05; // Crawl speed while blocking
                            action = 'strafe'; // Face the enemy to block correctly
                        } 
                        // Condition B: Enemy is far? RUN AWAY.
                        // Create distance so we can regenerate freely.
                        else {
                            e.isBlocking = false;
                            moveSpeed = 0.55; // Fast flee
                            action = 'flee';
                        }
                    } else {
                        // No target? Just chill and heal.
                        moveSpeed = 0;
                        action = 'stop';
                    }}
                
                // --- NEW: CHAMELEON KITING (While Scanning) ---
                if (e.realType === 'chameleon' && e.type === 'chameleon' && e.isScanning) {
                    moveSpeed = 0.55; // Move fast while scanning
                    
                    let dist = e.target ? Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2) : 0;
                    
                    // Stay away! (Kite Logic)
                    if (dist < 250) action = 'flee';
                    else if (dist > 350) action = 'chase';
                    else action = 'strafe';

                    // Ensure he doesn't try to block or ram while running away
                    e.isBlocking = false;
                    e.isRamming = false;
                    
                    return; 
                }

                moveSpeed = 0.45;

                
                
                // --- 1. DETERMINE STATE ---
                // Aggressive (Brave) vs Defensive (Cowardly)
                let isAggressive = e.bravery > 0.4; 
                const isHurt = e.hp < e.maxHp * 0.3;
                
                // NEW: CAUTION AGAINST ARMED OPPONENTS
                const armedTypes = ['knight', 'soldier', 'scythe', 'lance', 'pirate', 'rogue', 'wizard', 'bow'];
                const targetIsArmed = target && armedTypes.includes(target.type);
                
                // If target has a weapon, force defensive play unless we are very brave (0.8+)
                if (targetIsArmed && e.bravery < 0.8) {
                    isAggressive = false; 
                }

                // Check if actively blocking
                if (e.isBlocking) {
                    e.blockTimer--;
                    if(e.blockTimer <= 0) { e.isBlocking = false; e.blockCooldown = 120; }
                    moveSpeed = 0.05; // Slow crawl while blocking
                    action = 'stop';
                } 
                // Check if charging
                else if (e.isRamming) {
                    e.chargeTimer--;
                    if (e.chargeTimer <= 0) { e.isRamming = false; e.chargeCooldown = 180; }
                    // Maintain Charge Velocity
                    e.vx = Math.cos(e.angle) * 8; 
                    e.vy = Math.sin(e.angle) * 8;
                    spawnParticles(e.x, e.y, 'white', 1); 
                    return; // Skip other movement logic
                }
                else {
                    // Normal Decision Making
                    if (e.blockCooldown > 0) e.blockCooldown--;
                    if (e.chargeCooldown > 0) e.chargeCooldown--;

                    // --- NEW: WEAPON LOOT PRIORITY ---
                    // Only look for weapons if not in immediate melee danger (< 100px from enemy)
                    if (e.type === 'unarmed' || e.type === 'chameleon') {
                    if (pickups.length > 0 && dist > 100) {
                        let nearestWeapon = null;
                        let minWeaponDist = 600; // Look within this range

                        pickups.forEach(p => {
                            let d = Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2);
                            if (d < minWeaponDist) {
                                minWeaponDist = d;
                                nearestWeapon = p;
                            }
                        });

                        if (nearestWeapon) {
                            // Abandon the fight and run for the gun!
                            let angleToWeapon = Math.atan2(nearestWeapon.y - e.y, nearestWeapon.x - e.x);
                            e.vx += Math.cos(angleToWeapon) * 0.6; // Sprint for it
                            e.vy += Math.sin(angleToWeapon) * 0.6;
                            e.angle = angleToWeapon;
                            
                            // Visual cue: Look at weapon
                            return; 
                        }
                    }}
                    // --- END WEAPON PRIORITY ---
                    
                    
                    // A. SCAN FOR ENVIRONMENTAL HAZARDS
                    let bestHazard = null;
                    let minHazardDist = 9999;
                    
                    let hazards = [...obstacles]; 

                    hazards = obstacles.filter(o => o.type === 'barrel' || (o.type === 'rock' && isAggressive));

                    projectiles.forEach(p => {
                        // Check if it's a mine, and ensure the target isn't on the same team as the mine 
                        // (Teammates don't trigger mines, so pushing them into their own mine does nothing)
                        if (p.isMine && p.team !== target.team) {
                            hazards.push({x: p.x, y: p.y, radius: 15, type: 'mine'}); 
                        }
                    });



                    if (target.x < 100) hazards.push({x: 0, y: target.y, radius: 20, type: 'wall'});
                    if (target.x > canvas.width - 100) hazards.push({x: canvas.width, y: target.y, radius: 20, type: 'wall'});
                    if (target.y < 100) hazards.push({x: target.x, y: 0, radius: 20, type: 'wall'});
                    if (target.y > canvas.height - 100) hazards.push({x: target.x, y: canvas.height, radius: 20, type: 'wall'});
                    
                    hazards.forEach(h => {
                        let d = Math.sqrt((h.x - target.x)**2 + (h.y - target.y)**2);
                        if (d < 250 && d < minHazardDist) { 
                            minHazardDist = d;
                            bestHazard = h;
                        }
                    });
                    e.targetHazard = bestHazard; 
                    
                    // B. AGGRESSIVE LOGIC (If Brave or Target is Unarmed)
                    if (isAggressive && !isHurt) {
                        // 1. Charge Logic
                        if (e.chargeCooldown <= 0 && dist < 200 && dist > 80 && hasLineOfSight(e, target)) {
                            if (bestHazard) {
                                let angleToEnemy = Math.atan2(target.y - e.y, target.x - e.x);
                                let angleToHazard = Math.atan2(bestHazard.y - e.y, bestHazard.x - e.x);
                                if (Math.abs(angleToEnemy - angleToHazard) < 0.5) { 
                                    e.isRamming = true; e.chargeTimer = 30; playSound('heavy_hit'); return;
                                }
                            } else {
                                if (Math.random() < 0.01) { e.isRamming = true; e.chargeTimer = 30; playSound('heavy_hit'); return;}
                            }
                        }
                        
                        // 2. Positioning Logic (Hazard Push)
                        if (bestHazard && dist < 300) {
                            let hx = bestHazard.x; let hy = bestHazard.y;
                            let dirX = target.x - hx; let dirY = target.y - hy;
                            let len = Math.sqrt(dirX*dirX + dirY*dirY) || 1;
                            let destX = target.x + (dirX/len) * 100;
                            let destY = target.y + (dirY/len) * 100;
                            
                            let moveAngle = Math.atan2(destY - e.y, destX - e.x);
                            e.vx += Math.cos(moveAngle) * moveSpeed;
                            e.vy += Math.sin(moveAngle) * moveSpeed;
                            e.angle = Math.atan2(target.y - e.y, target.x - e.x);
                            
                            if (Math.sqrt((destX-e.x)**2 + (destY-e.y)**2) < 50) action = 'chase';
                            else return;
                        } else {
                            action = 'chase';
                        }
                    } 
                    // C. DEFENSIVE/TACTICAL LOGIC (Target is Armed or We are Hurt)
                    else {
                        // NEW: Higher block chance if target is armed and facing us
                        if (targetIsArmed && dist < 120 && e.blockCooldown <= 0) {
                            // Check if they are attacking/facing us
                            let angleToUs = Math.atan2(e.y - target.y, e.x - target.x);
                            let diff = Math.abs(angleToUs - target.angle);
                            if (diff < 1.0) { // They are looking right at us
                                if (Math.random() < 0.1) { e.isBlocking = true; e.blockTimer = 60; }
                            }
                        }

                        // Baiting Logic
                        if (bestHazard && dist < 300) {
                             let hx = bestHazard.x; let hy = bestHazard.y;
                             let dirX = hx - target.x; let dirY = hy - target.y; 
                             let len = Math.sqrt(dirX*dirX + dirY*dirY);
                             let destX = hx + (dirX/len) * 80; 
                             let destY = hy + (dirY/len) * 80;
                             
                             let moveAngle = Math.atan2(destY - e.y, destX - e.x);
                             e.vx += Math.cos(moveAngle) * moveSpeed;
                             e.vy += Math.sin(moveAngle) * moveSpeed;
                             
                             if (dist < 80 && e.blockCooldown <= 0) { e.isBlocking = true; e.blockTimer = 60; }
                             return;
                        }
                        
                        // Default defensive
                        if (dist < 100 && e.blockCooldown <= 0) { e.isBlocking = true; e.blockTimer = 60; } 
                        else if (dist > 200) { action = 'chase'; } // Still close distance eventually
                        else { action = 'strafe'; } // Strafe around them carefully
                    }
                }
            }
            // END UNARMED AI OVERRIDE

            // ... (After Unarmed AI Override) ...

            // START ROGUE AI OVERRIDE: aim for the ball, avoid weapon arcs
            if (e.type === 'rogue' && e.target) {
                const weaponThreats = ['knight', 'lance', 'scythe', 'samurai', 'pirate', 'bard', 'trapper', 'adapto', 'fight knight'];
                const targetIsWeaponUser = weaponThreats.includes(e.target.type) || (e.target.currentMode === 'sword');

                const toRogueFromTarget = Math.atan2(e.y - e.target.y, e.x - e.target.x);
                let frontDiff = Math.abs(toRogueFromTarget - (e.target.angle || 0));
                while (frontDiff > Math.PI) frontDiff = 2 * Math.PI - frontDiff;

                const enemyReach = Math.max(e.target.reach || 0, 45);
                const tooNearWeapon = targetIsWeaponUser && frontDiff < 1.25 && dist < enemyReach + 95;

                moveSpeed = e.isStealthed ? 0.72 : 0.58;

                if (tooNearWeapon) {
                    const flankSide = ((Math.floor(frameCount / 45) + Math.floor(e.id * 1000)) % 2 === 0) ? 1 : -1;
                    const flankAngle = (e.target.angle || targetAngle) + Math.PI + flankSide * 0.75;
                    const flankPoint = clampArenaPoint(
                        e.target.x + Math.cos(flankAngle) * 62,
                        e.target.y + Math.sin(flankAngle) * 62,
                        30
                    );

                    targetAngle = Math.atan2(flankPoint.y - e.y, flankPoint.x - e.x);
                    action = 'chase';

                    if (frameCount % 50 === 0) {
                        spawnDamageText(e.x, e.y - 24, "FLANK", "#b2bec3");
                    }
                } else {
                    targetAngle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                    action = dist < 55 ? 'strafe' : 'chase';
                }

                let rogueDiff = targetAngle - e.angle;
                while (rogueDiff < -Math.PI) rogueDiff += Math.PI * 2;
                while (rogueDiff > Math.PI) rogueDiff -= Math.PI * 2;
                e.angle += rogueDiff * 0.25;
            }
            // END ROGUE AI OVERRIDE

            // START SPATIAL FLANKING AI OVERRIDE
            if (e.type === 'spatial' && e.target && e.slamTargets.length === 0) {
                // List of enemies where facing direction matters (Shields, Long Weapons, Guns)
                const directionalFoes = ['knight', 'lance', 'scythe', 'pirate', 'soldier', 'bow', 'wizard', 'rogue', 'unarmed'];
                
                if (directionalFoes.includes(e.target.type)) {
                    // 1. Calculate the "Back" Angle (Opposite to where they are facing)
                    // We use the target's velocity angle or their stored angle
                    let targetFacing = e.target.angle;
                    let backAngle = targetFacing + Math.PI;

                    // 2. Define a "Flank Point" behind them
                    const flankDistance = 60; // How far behind to orbit
                    let flankX = e.target.x + Math.cos(backAngle) * flankDistance;
                    let flankY = e.target.y + Math.sin(backAngle) * flankDistance;

                    // 3. Check if we are already in position (behind them)
                    let distToFlank = Math.sqrt((flankX - e.x)**2 + (flankY - e.y)**2);
                    let distToTarget = Math.sqrt((e.target.x - e.x)**2 + (e.target.y - e.y)**2);

                    // If we are not behind them yet, and we aren't literally touching them
                    if (distToFlank > 40 && distToTarget > 40) {
                        
                        // Move towards the FLANK point, not the enemy center
                        let angleToFlank = Math.atan2(flankY - e.y, flankX - e.x);
                        
                        // Increase speed slightly for the flanking maneuver
                        let flankSpeed = 0.55; 
                        
                        e.vx += Math.cos(angleToFlank) * flankSpeed;
                        e.vy += Math.sin(angleToFlank) * flankSpeed;

                        // Add a little orbital strafe to prevent walking straight through them
                        // If we are in front, push sideways
                        let angleToEnemy = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                        let angleDiff = Math.abs(angleToEnemy - targetFacing);
                        // If facing each other (diff is near PI), strafe hard
                        if (angleDiff > 2.0) {
                             e.vx += Math.cos(angleToEnemy + Math.PI/2) * 0.3;
                             e.vy += Math.sin(angleToEnemy + Math.PI/2) * 0.3;
                        }

                        return; // Override default chase logic
                    }
                    // If distToFlank is small, we are behind them! 
                    // Fall through to default logic which causes a direct 'chase' attack.
                }
            }
            // END SPATIAL FLANKING AI OVERRIDE

            if (e.type === 'knight' && target.type === 'knight') {
                let flankAngle = target.angle + Math.PI;
                let flankX = target.x + Math.cos(flankAngle) * 50; let flankY = target.y + Math.sin(flankAngle) * 50;
                targetAngle = Math.atan2(flankY - e.y, flankX - e.x);
            }

            if (e.type === 'lance') { e.angle = targetAngle; if (dist > 100 && dist < 300) e.reach = Math.min(e.reach + 5, 200); else e.reach = Math.max(e.reach - 5, 80); } 
            else if (e.type === 'scythe') {
                if (e.spinCooldown > 0) e.spinCooldown--;
                if (e.spinCooldown <= 0 && dist < 120) { e.spinTimer = 60; e.spinCooldown = 240; }
                if (e.spinTimer > 0) { e.spinTimer--; e.angle += 0.8; } else e.angle = targetAngle; 
            }
            else if (e.type === 'unarmed') {
                // Angle is handled in the AI Override above for complex movement,
                // but if falling through to here:
                if (!e.isRamming) e.angle = targetAngle; // Always face target unless charging logic overrides
            }
            else if (['bow', 'laser', 'knight', 'orbiter', 'wizard', 'pirate', 'grabber', 'rogue', 'chameleon', 'devourer', 'alchemist', 'engineer', 'vampire', 'bard', 'spatial'].includes(e.type)) { // Spatial is melee now
                // Angle logic is handled by the generic angle update above.
            } 

            if (e.type === 'duplicator') { moveSpeed = 0.5; if (e.bravery >= 1.0 || e.isFrenzied) moveSpeed = 0.6; }
            if (e.type === 'rogue' && e.isStealthed) moveSpeed = 0.6; 
            if (e.type === 'chrono') moveSpeed = 0.4;
            if (e.type === 'unarmed' && e.isBlocking) moveSpeed = 0.05; // Move very slow while blocking

            // Projectile Evasion (All Units except Turrets)
            if (e.type !== 'turret' && e.type !== 'boid') {
                let nearestProjectile = projectiles.find(p => p.team !== e.team && Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2) < 120);
                if (nearestProjectile) { 
                    // Try to dodge or move to cover
                    
                    let closestCover = null;
                    let minCoverDist = 9999;
                    obstacles.forEach(o => {
                        if (o.type === 'lava') return; // Lava is not cover
                        const d = Math.sqrt((o.x - e.x)**2 + (o.y - e.y)**2);
                        if (d < minCoverDist) { minCoverDist = d; closestCover = o; }
                    });

                    if (closestCover && hasLineOfSight(e, target)) {
                        // If target is visible, use lateral dodge
                         let pAngle = Math.atan2(nearestProjectile.vy, nearestProjectile.vx); 
                         let dodgeAngle = pAngle + Math.PI/2 * (Math.random() > 0.5 ? 1 : -1);
                         e.vx += Math.cos(dodgeAngle) * 0.8; e.vy += Math.sin(dodgeAngle) * 0.8;
                         action = 'dodge';
                    } else if (closestCover) {
                         // If LOS is blocked or no projectile, move toward cover for safety
                         const coverAngle = Math.atan2(closestCover.y - e.y, closestCover.x - e.x);
                         e.vx += Math.cos(coverAngle) * 0.8; 
                         e.vy += Math.sin(coverAngle) * 0.8;
                         action = 'flee';
                    } else {
                         // Simple scatter dodge
                         e.vx += (Math.random() - 0.5) * 0.8;
                         e.vy += (Math.random() - 0.5) * 0.8;
                         action = 'dodge';
                    }
                }
            }

            // START ENVIRONMENT AVOIDANCE & NAVIGATION
            if (e.type !== 'turret' && e.type !== 'boid' && !e.isRamming) {
                obstacles.forEach(o => {
                    let dx = e.x - o.x;
                    let dy = e.y - o.y;
                    let dist = Math.sqrt(dx*dx + dy*dy);
                    let minDist = e.radius + o.radius;

                    // 1. HAZARD AVOIDANCE (Fear) - Lava & Spikes
                    if (o.type === 'lava' || o.type === 'spike') {
                        let avoidRadius = minDist + 40;
                        if (dist < avoidRadius) {
                            let urgency = (avoidRadius - dist) / 40; 
                            if (urgency > 1.0) urgency = 1.0;
                            let strength = 0.8 * urgency; 
                            e.vx += (dx / dist) * strength;
                            e.vy += (dy / dist) * strength;
                        }
                    }
                    // 2. OBSTACLE NAVIGATION (Rocks) - Pathfinding around
                    else if (o.type === 'rock' && e.target) {
                        let navRadius = minDist + 60; // Detection range
                        
                        // Check if rock is close
                        if (dist < navRadius) {
                            let angleToObs = Math.atan2(-dy, -dx); // Angle to rock center
                            let angleToTarget = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                            
                            // Check difference between "Looking at Target" vs "Looking at Rock"
                            let diff = Math.abs(angleToObs - angleToTarget);
                            while (diff > Math.PI) diff = 2*Math.PI - diff;

                            // If rock is blocking the path to target (within ~60 deg cone)
                            if (diff < 1.0) {
                                // STUCK CHECK: Are we hugging the rock and not moving?
                                let speed = Math.sqrt(e.vx*e.vx + e.vy*e.vy);
                                if (dist < minDist + 5 && speed < 0.5) {
                                    // STUCK -> DESTROY MODE
                                    // Do NOT steer. Let the 'chase' logic push us into the rock.
                                    // The collision logic will damage the rock.
                                } else {
                                    // NAVIGATION -> STEER AROUND
                                    // Apply repulsive force from the rock to slide around it
                                    let steerFactor = 0.5;
                                    e.vx += (dx / dist) * steerFactor;
                                    e.vy += (dy / dist) * steerFactor;
                                }
                            }
                        }
                    }
                });
            }
                            // ADAPTO SPECIAL NAVIGATION:
                // If his line of sight is blocked, he actively flanks instead of just bumping the obstacle.
                if (e.type === 'adapto' && e.target && !hasLineOfSight(e, e.target)) {
                    const side = ((e.id + Math.floor(frameCount / 80)) % 2 === 0) ? 1 : -1;
                    const flankAngle = Math.atan2(e.target.y - e.y, e.target.x - e.x) + side * Math.PI / 2;

                    e.vx += Math.cos(flankAngle) * 0.75;
                    e.vy += Math.sin(flankAngle) * 0.75;

                    action = 'dodge';

                    if (frameCount % 90 === 0) {
                        spawnDamageText(e.x, e.y - 28, "FLANK", "#00c3ff");
                    }
                }
            // END ENVIRONMENT AVOIDANCE


            if (e.speedChaos) {
    moveSpeed *= e.speedChaos;
}

if (action === 'chase') {
    e.vx += Math.cos(targetAngle) * moveSpeed;
    e.vy += Math.sin(targetAngle) * moveSpeed;
} 
else if (action === 'flee') {
    e.vx -= Math.cos(targetAngle) * moveSpeed;
    e.vy -= Math.sin(targetAngle) * moveSpeed;
} 
else if (action === 'strafe') {
    e.vx += Math.cos(targetAngle + Math.PI / 2) * moveSpeed;
    e.vy += Math.sin(targetAngle + Math.PI / 2) * moveSpeed;
}

if (action !== 'stop' && action !== 'charge' && action !== 'dodge') {
    const noise = e.decisionNoise || 0.2;
    e.vx += (Math.random() - 0.5) * noise;
    e.vy += (Math.random() - 0.5) * noise;
}
        }

        function applyPetAI(e) {

            // --- SLEEP LOGIC ---
    // 1. If already sleeping
    if (e.isSleeping) {
        // Stop moving
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.angle += 0.02; // Slow breathing rotation

        // Regenerate stats
        e.fun += 0.2;
        e.hunger += 0.05; // Digestion? (Optional)
        
        // Visuals
        if (frameCount % 40 === 0) {
            spawnDamageText(e.x + 10, e.y - 20, "Zzz", "#fff");
        }

        // Wake up conditions: Fun is full OR disturbed by mouse
        let distToMouse = Math.sqrt((globalMouseX - e.x)**2 + (globalMouseY - e.y)**2);
        
        if (e.fun >= 100 || distToMouse < e.radius + 10) {
            e.isSleeping = false;
            spawnParticles(e.x, e.y, 'white', 5); // Poof
            e.petTimer = 0; // Reset pet timer so they don't instantly sleep again
        }
        return; // SKIP the rest of the AI (Wander, Chase, etc.)
    }

    // 2. Decide to Sleep
    // Sleep if Fun is low (bored) AND not holding food AND random chance
    if (e.fun < 30 && !dragPickup && Math.random() < 0.005) {
        e.isSleeping = true;
        return;
    }
    
    // 1. Hunger Decay
    if (frameCount % 60 === 0) e.hunger -= 1; 
    if (e.hunger < 0) e.hunger = 0;

    if (frameCount % 60 === 0) e.fun -= 1; // Pets get bored over time
if (e.fun < 0) e.fun = 0;              // Prevent negative fun

    let moveSpeed = 0.3;
    let action = 'wander';
    let targetAngle = e.angle;

    // --- NEW: CHECK IF PLAYER IS HOLDING FOOD ---
    if (dragPickup) {
        let distToFood = Math.sqrt((dragPickup.x - e.x)**2 + (dragPickup.y - e.y)**2);
        // If holding food nearby, they ALL chase it!
        if (distToFood < 400) {
            action = 'chase_food';
            targetAngle = Math.atan2(dragPickup.y - e.y, dragPickup.x - e.x);
            moveSpeed = 0.65; // Run fast for food
            
            // Happy hop
            if (frameCount % 20 === 0) e.vy -= 2; 
        }
    }

    // 2. PLAY FIGHTING (TAG)
    // If not hungry and not chasing player food, find a friend to "boop"
    if (action === 'wander' && e.hunger > 30) {
        // Find nearest other pet
        let nearest = null;
        let minD = 300;
        entities.forEach(friend => {
            if (friend.id !== e.id) {
                let d = Math.sqrt((friend.x - e.x)**2 + (friend.y - e.y)**2);
                if (d < minD) { minD = d; nearest = friend; }
            }
        });

        if (nearest) {
            let dist = minD;
            // If Bravery is high, CHASE (It's "IT")
            if (e.bravery > 0.5) {
                action = 'play_chase';
                targetAngle = Math.atan2(nearest.y - e.y, nearest.x - e.x);
                moveSpeed = 0.4;
                
                // If we touch them, bounce back (Boop!)
                if (dist < e.radius + nearest.radius + 5) {
                    e.vx = -Math.cos(targetAngle) * 5;
                    e.vy = -Math.sin(targetAngle) * 5;
                    // Visual "Tag"
                    spawnParticles((e.x+nearest.x)/2, (e.y+nearest.y)/2, 'pink', 3);
                }
            } 
            // If Bravery is low, RUN (Don't get tagged)
            else {
                if (dist < 150) {
                    action = 'play_flee';
                    targetAngle = Math.atan2(nearest.y - e.y, nearest.x - e.x) + Math.PI; // Run away
                    moveSpeed = 0.45;
                }
            }
        }
    }

    // 3. HUNGER LOGIC (Overrides Play)
    // If food is on the ground (and not being dragged), eat it
    if (e.hunger < 70 && !dragPickup) {
        let closestFood = null;
        let minDist = 9999;
        pickups.forEach(p => {
            let d = Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2);
            if (d < minDist) { minDist = d; closestFood = p; }
        });

        if (closestFood) {
            action = 'eat';
            targetAngle = Math.atan2(closestFood.y - e.y, closestFood.x - e.x);
            moveSpeed = 0.5;
        }
    }

    // 4. MOUSE PETTING
    let distToMouse = Math.sqrt((globalMouseX - e.x)**2 + (globalMouseY - e.y)**2);
    if (distToMouse < e.radius) {
        e.petTimer++;
        if (e.petTimer > 10) {
            e.fun += 1;
            e.petTimer = 0;
            spawnParticles(e.x, e.y, 'pink', 1, 'note'); 
        }
    }

    // 5. APPLY PHYSICS
    if (action === 'wander') {
        e.vx += (Math.random() - 0.5) * 0.2;
        e.vy += (Math.random() - 0.5) * 0.2;
        // Keep them inside bounds gently
        if(e.x < 50) e.vx += 0.5;
        if(e.x > canvas.width - 50) e.vx -= 0.5;
        if(e.y < 50) e.vy += 0.5;
        if(e.y > canvas.height - 50) e.vy -= 0.5;
    } else {
        e.vx += Math.cos(targetAngle) * moveSpeed;
        e.vy += Math.sin(targetAngle) * moveSpeed;
        
        // Turn visually
        let diff = targetAngle - e.angle;
        while (diff < -Math.PI) diff += Math.PI*2; while (diff > Math.PI) diff -= Math.PI*2; 
        e.angle += diff * 0.1;
    }
}

        function resolveCollisions() {
            // NEW: List of classes that use melee weapons/attacks and shouldn't take collision damage when attacking
            const MELEE_WEAPON_USERS = ['knight', 'pirate', 'rogue', 'samurai', 'scythe', 'lance', 'bard', 'trapper', 'spatial', 'devourer', 'grabber', 'vampire', 'boid', 'mammoth_mount'];
            // Unarmed is deliberately NOT in this list so it deals body damage via momentum dominance

            entities.forEach(e => {
                if (e.teleportCooldown > 0) return;
                portals.forEach(p => {
                    let d = Math.sqrt((e.x - p.x)**2 + (e.y - p.y)**2);
                    if (d < 30) {
                        let exit = portals.find(link => link.id === p.link);
                        if (exit) { 
                            e.x = exit.x; // FIX: Should use exit.x and exit.y
                            e.y = exit.y; // FIX: Should use exit.x and exit.y
                            e.teleportCooldown = 60; 
                            spawnParticles(p.x, p.y, p.color, 10); 
                            spawnParticles(exit.x, exit.y, exit.color, 10); 
                        }
                    }
                });
            });

            // Trap Activation (NEW)
            traps.forEach(t => {
                // If trap is already sprung or lifespan expired, ignore
                if (t.trappedEnemyId || t.life <= 0) return;

                entities.forEach(e => {
                    // Only enemies can activate traps
                    if (e.team !== t.team) {
                        let d = Math.sqrt((e.x - t.x)**2 + (e.y - t.y)**2);
                        if (d < e.radius + t.radius) {
                            // Trap is sprung!
                            t.trappedEnemyId = e.id;
                            t.duration = 80; // <--- EXACTLY 2 SECONDS (60fps * 2)
                            e.trappedBy = t.ownerId; 
                            e.frozen = 80; // Freeze their AI/Movement
                            e.vx = 0; e.vy = 0;
                            
                            playSound('clash');
                            spawnParticles(e.x, e.y, 'brown', 15);
                            
                            // Tag for kill feed
                            e.lastAttackerId = t.ownerId; 
                        }
                    }
                });
            });


            projectiles.forEach(p => {
                if (p.dead) return;
                
                // --- HOOK COLLISION (MODIFIED) ---
                if (p.type === 'hook') {
                    // Hook can hit enemies
                    entities.forEach(e => {
                        if (e.team !== p.team && !p.dead) {
                            
                            // KNIGHT DEFLECTION LOGIC
                            if (e.type === 'knight') {
                                let angleToHook = Math.atan2(p.y - e.y, p.x - e.x);
                                let diff = Math.abs(angleToHook - e.angle);
                                if (diff > Math.PI) diff = 2*Math.PI - diff;
                                
                                // Deflect if hitting the front (shield)
                                if (diff < 1.0) {
                                    p.dead = true;
                                    playSound('clash');
                                    spawnParticles(p.x, p.y, 'gold', 8); // Sparks
                                    return; 
                                }
                            }

                            let d = Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2);
                            if (d < e.radius + 5) {
                                // Hook Hit!
                                e.grappledBy = p.shooterId;
                                p.dead = true;
                                playSound('clash');
                                spawnParticles(e.x, e.y, 'grey', 5);
                            }
                        }
                    });
                    
                    // Hook hits obstacles
                    if (!p.dead) {
                        obstacles.forEach(o => {
                            if (o.type === 'lava') return; // Hook goes over lava
                            let d = Math.sqrt((p.x - o.x)**2 + (p.y - o.y)**2);
                            if (d < o.radius + 5) {
                                p.dead = true;
                                spawnParticles(p.x, p.y, '#777', 3);
                            }
                        });
                    }
                    return; // Don't run standard projectile logic for hook
                }

                // --- SPATIAL REDIRECTION LOGIC ---
                portals.forEach(portal => {
                    let d = Math.sqrt((p.x - portal.x)**2 + (p.y - portal.y)**2);
                    // Check if projectile hits portal area (Portal radius is 20)
                    if (d < 30 && p.type !== 'potion' && p.type !== 'cannonball' && p.type !== 'fireball') { 
                        
                        const shooter = entities.find(e => e.id === p.shooterId);
                        
                        if (shooter) {
                            // Calculate angle to redirect back to the shooter's current position
                            const dx = shooter.x - p.x;
                            const dy = shooter.y - p.y;
                            const angle = Math.atan2(dy, dx);
                            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

                            p.vx = Math.cos(angle) * speed * 1.5; // Faster redirect
                            p.vy = Math.sin(angle) * speed * 1.5;
                            p.team = shooter.team; // Friendly fire to the original shooter's team
                            p.shooterId = portal.id; // Assign portal ID or spatial owner ID as new shooter (For attribution)
                            
                            spawnParticles(p.x, p.y, 'cyan', 5);
                            playSound('zap');
                        }
                        
                        // Prevent projectile from hitting multiple portals in one frame
                        // p.dead = true; // DO NOT KILL IT, keep it alive to hit the shooter
                    }
                });
                // --- END SPATIAL REDIRECTION LOGIC ---

                entities.forEach(wielder => {
                    if (wielder.team !== p.team) {
                        let hitWeapon = false; let tipX, tipY;
                        if (wielder.type === 'knight') {
                            let angleToProj = Math.atan2(p.y - wielder.y, p.x - wielder.x);
                            let angleDiff = Math.abs(angleToProj - wielder.angle);
                            if (angleDiff > Math.PI) angleDiff = 2*Math.PI - angleDiff;
                            if (angleDiff < 1.2) hitWeapon = true;
                        } 
                        else if (wielder.type === 'lance' || wielder.type === 'scythe' || wielder.type === 'bard' || wielder.type === 'samurai') {
                            tipX = wielder.x + Math.cos(wielder.angle) * wielder.reach;
                            tipY = wielder.y + Math.sin(wielder.angle) * wielder.reach;
                            if (pointToLineDist(p.x, p.y, wielder.x, wielder.y, tipX, tipY) < 15) {
    // Samurai can deflect, but not always.
    if (wielder.type === 'samurai') {
        hitWeapon = Math.random() < 0.35;
    } else {
        hitWeapon = true;
    }
}
                        }
                        if (hitWeapon) { 
                            // NEW: Collision of projectile with weapon counts as a "clash" not a hit.
                            p.vx *= -1.2; p.vy *= -1.2; 
                            p.team = wielder.team; 
                            p.shooterId = wielder.id; // New shooter ID for deflected projectile
                            spawnParticles(p.x, p.y, 'white', 5); playSound('clash'); 
                        }
                    }
                });
            });

            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    let a = entities[i]; let b = entities[j];

                    // Mammoth rider sits on top of its own mount. Do not run normal ball collision
                    // between the rider and mount, or they jitter/push each other forever.
                    if (
                        (a.type === 'mammoth_mount' && b.id === a.ownerId) ||
                        (b.type === 'mammoth_mount' && a.id === b.ownerId)
                    ) {
                        continue;
                    }

                    if (a.type === 'grabber' && a.team !== b.team && a.heldTargets.length < 2 && a.grabCooldown <= 0) {
                        let d = Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
                        if (d < a.radius + b.radius + 20 && !b.heldBy) { 
                            a.heldTargets.push(b.id); 
                            b.heldBy = a.id; 
                            b.grabTimer = 120; // 2 seconds (120 frames)
                            playSound('hit'); 
                            continue; 
                        }
                    }
                    if (b.type === 'grabber' && b.team !== a.team && b.heldTargets.length < 2 && b.grabCooldown <= 0) {
                        let d = Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
                        if (d < a.radius + b.radius + 20 && !a.heldBy) { 
                            b.heldTargets.push(a.id); 
                            a.heldBy = b.id; 
                            a.grabTimer = 120; // 2 seconds (120 frames)
                            playSound('hit'); 
                            continue; 
                        }
                    }

                    if (a.type === 'duplicator' && b.type === 'duplicator' && a.team === b.team) {
                        let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.sqrt(dx*dx + dy*dy); let minDist = a.radius + b.radius;
                        if (dist < minDist) {
                            let overlap = minDist - dist; let angle = Math.atan2(dy, dx); let tx = Math.cos(angle); let ty = Math.sin(angle);
                            a.x -= tx * overlap * 0.5; a.y -= ty * overlap * 0.5; b.x += tx * overlap * 0.5; b.y += ty * overlap * 0.5;
                        }
                        continue; 
                    }
                    
                    // BOID SEPARATION (Simple physical push logic if they get too close despite AI)
                    if (a.type === 'boid' && b.type === 'boid') {
                        let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.sqrt(dx*dx + dy*dy); let minDist = a.radius + b.radius;
                        if (dist < minDist) {
                            let overlap = minDist - dist; let angle = Math.atan2(dy, dx); let tx = Math.cos(angle); let ty = Math.sin(angle);
                            a.x -= tx * overlap * 0.5; a.y -= ty * overlap * 0.5; b.x += tx * overlap * 0.5; b.y += ty * overlap * 0.5;
                        }
                        continue;
                    }

                    // Turret Collision Logic (Semi-solid)
                    if (a.type === 'turret' || b.type === 'turret') {
                         let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.sqrt(dx*dx + dy*dy); let minDist = a.radius + b.radius;
                         if (dist < minDist) { 
                             let overlap = minDist - dist; let angle = Math.atan2(dy, dx); let tx = Math.cos(angle); let ty = Math.sin(angle);
                             if (a.type === 'turret' && b.type !== 'turret') { b.x += tx * overlap; b.y += ty * overlap; b.vx += tx * 0.5; b.vy += ty * 0.5; }
                             else if (b.type === 'turret' && a.type !== 'turret') { a.x -= tx * overlap; a.y -= ty * overlap; a.vx -= tx * 0.5; a.vy -= ty * 0.5; }
                         }
                         continue;
                    }

                    let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.sqrt(dx*dx + dy*dy); let minDist = a.radius + b.radius;

                    if (dist < minDist) { 
                        // --- FIGHT KNIGHT SPIKED ARMOR ---
                        // Deals damage on contact if armor is present (Stage < 4)
                        if (a.type === 'fight knight' && a.hasFeigned && a.resurrectionStage < 4) {
                            damageEntity(b, 1.2, (a.x+b.x)/2, (a.y+b.y)/2, a);
                            if(frameCount % 10 === 0) spawnParticles((a.x+b.x)/2, (a.y+b.y)/2, 'grey', 1);
                        }
                        if (b.type === 'fight knight' && b.resurrectionStage < 4) {
                            damageEntity(a, 1.2, (a.x+b.x)/2, (a.y+b.y)/2, b);
                            if(frameCount % 10 === 0) spawnParticles((a.x+b.x)/2, (a.y+b.y)/2, 'grey', 1);
                        }
                        // VAMPIRE BAT COLLISION AVOIDANCE (no damage, just push)
                        
                        let angle = Math.atan2(dy, dx); let tx = Math.cos(angle); let ty = Math.sin(angle); let overlap = minDist - dist;
                        a.x -= tx * overlap * 0.5; a.y -= ty * overlap * 0.5; b.x += tx * overlap * 0.5; b.y += ty * overlap * 0.5;

                        let vRelX = a.vx - b.vx; let vRelY = a.vy - b.vy;
                        let tempVx = a.vx; a.vx = b.vx; b.vx = tempVx; let tempVy = a.vy; a.vy = b.vy; b.vy = tempVy;
                        
                        if (a.team === b.team && GAME_MODE !== 'ffa' && !a.isParanoid && !b.isParanoid) continue;

                        // IF VAMPIRE IS BAT: No collision damage calc
                        if ((a.type === 'vampire' && a.isBat) || (b.type === 'vampire' && b.isBat)) continue;

                        

                        let baseDmg = 0.5; 
                        
                        // --- NEW: Fix Duplicator vs Duplicator damage ---
                        // Increases damage so it registers as a "Hit" (triggers visual flash + sound)
                        if (a.type === 'duplicator' && b.type === 'duplicator') {
                            baseDmg = 2.0; 
                        }
                                                
                        
                        let aDmg = baseDmg * a.mass; let bDmg = baseDmg * b.mass;
                        
                        // Boid collision damage is tiny
                        if (a.type === 'boid') aDmg = 0.2;
                        if (b.type === 'boid') bDmg = 0.2;
                        
                        // Unarmed Boost: Unarmed hits harder on collision because they use their body
                        if (a.type === 'unarmed' && !a.isBlocking) aDmg *= 3.0; // BUFFED from 2.5
                        if (b.type === 'unarmed' && !b.isBlocking) bDmg *= 3.0;
                        
                        // Charge Bonus
                        if (a.type === 'unarmed' && a.isRamming) aDmg *= 2.0;
                        if (b.type === 'unarmed' && b.isRamming) bDmg *= 2.0;

                        let impact = Math.sqrt(vRelX*vRelX + vRelY*vRelY);
                        if (impact > 3) { aDmg += impact * 0.5; bDmg += impact * 0.5; }
                        
                        if (a.type === 'devourer' && a.isDampening && a.team !== b.team) {
                            b.hp = 0; a.hp = Math.min(a.hp + 100, a.maxHp); playSound('explosion'); continue;
                        }
                        if (b.type === 'devourer' && b.isDampening && b.team !== a.team) {
                            a.hp = 0; b.hp = Math.min(b.hp + 100, b.maxHp); playSound('explosion'); continue;
                        }

                        // Momentum Dominance
                        let momA = Math.sqrt(a.vx**2 + a.vy**2) * a.mass;
                        let momB = Math.sqrt(b.vx**2 + b.vy**2) * b.mass;
                        let totalMom = momA + momB;
                        if (totalMom === 0) totalMom = 1;
                        
                        let dmgToB = (aDmg + bDmg) * (momA / totalMom); 
                        let dmgToA = (aDmg + bDmg) * (momB / totalMom);

                        // --- UPDATED: Disable collision damage from Incapacitated units ---
                        // Checks for: Stunned (frozen), Dancing, Held (Grabber), Trapped (Trapper), Hooked (Grappled)
                        if (a.frozen > 0 || a.isDancing || a.heldBy || a.trappedBy || a.grappledBy) dmgToB = 0; 
                        if (b.frozen > 0 || b.isDancing || b.heldBy || b.trappedBy || b.grappledBy) dmgToA = 0;

                        // MODIFIED: Removed isFrenzied check so clones take damage on impact
                        if (a.isRamming) dmgToA = 0;
                        if (b.isRamming) dmgToB = 0;

                        // NEW: Weapon Lead Logic
                        // If a unit is using a melee weapon and facing the target, the weapon absorbs the collision impact.
                        if (MELEE_WEAPON_USERS.includes(a.type)) {
                            let angleToB = Math.atan2(dy, dx); 
                            let diff = angleToB - a.angle;
                            // Normalize to -PI to PI
                            while (diff < -Math.PI) diff += Math.PI*2;
                            while (diff > Math.PI) diff -= Math.PI*2;
                            // If facing roughly towards the enemy (within ~70 degrees), take no self-damage
                            if (Math.abs(diff) < 1.2) dmgToA = 0; 
                        }
                        if (MELEE_WEAPON_USERS.includes(b.type)) {
                            let angleToA = Math.atan2(-dy, -dx);
                            let diff = angleToA - b.angle;
                            while (diff < -Math.PI) diff += Math.PI*2;
                            while (diff > Math.PI) diff -= Math.PI*2;
                            if (Math.abs(diff) < 1.2) dmgToB = 0;
                        }

                        // NEW: Record collision damage source
                        let attackerA = a.team !== b.team ? a : null;
                        let attackerB = b.team !== a.team ? b : null;
                        
                        // NEW: Wall Slam/Push Tracking
                        // If one was significantly heavier/faster, mark them as the "Pusher"
                        // This allows us to award kill credit if they push the victim into a hazard later
                        if (momA > momB * 1.5 && a.type === 'unarmed') { b.lastPushedBy = a.id; b.pushTimer = 60; }
                        if (momB > momA * 1.5 && b.type === 'unarmed') { a.lastPushedBy = b.id; a.pushTimer = 60; }


                        // Unarmed specific sound for body slam
                        if ((a.type === 'unarmed' || b.type === 'unarmed') && impact > 4) playSound('hit');

                        if (dmgToB > 1 || b.type === 'boid') damageEntity(b, dmgToB, (a.x+b.x)/2, (a.y+b.y)/2, attackerA); else b.hp -= dmgToB;
                        if (dmgToA > 1 || a.type === 'boid') damageEntity(a, dmgToA, (a.x+b.x)/2, (a.y+b.y)/2, attackerB); else a.hp -= dmgToA;
                    }
                }
            }
            
            // --- ENTITY VS OBSTACLE COLLISION (NEW) ---
            entities.forEach(e => {
                // Skip collision logic during setup to allow placement on top
                if (isSetupPhase && e.type !== 'turret') return; 

                obstacles.forEach(o => {
                    if (o.type === 'lava' || o.type === 'ice') return;

                    let dx = o.x - e.x;
                    let dy = o.y - e.y;
                    let dist = Math.sqrt(dx*dx + dy*dy);
                    let minDist = e.radius + o.radius;

                    if (dist < minDist) {
                        // Push entity out of obstacle
                        let overlap = minDist - dist;
                        let angle = Math.atan2(dy, dx);
                        let tx = Math.cos(angle);
                        let ty = Math.sin(angle);
                        
                        e.x -= tx * overlap; 
                        e.y -= ty * overlap;

                        // --- BARREL LOGIC ---
    if (o.type === 'barrel') {
        // 1. Existing Push Logic
        let pushForce = 0.5;
        o.vx -= tx * pushForce * (e.mass || 1); 
        o.vy -= ty * pushForce * (e.mass || 1);
        o.vx += e.vx * 0.5;
        o.vy += e.vy * 0.5;

        // 2. NEW: High Speed Impact Trigger (Thrown enemies trigger explosion)
        let impactSpeed = Math.sqrt(e.vx**2 + e.vy**2);
        if (impactSpeed > 8) { // If moving faster than 8 (Grabber throws at ~15)
            o.hp = 0; // INSTANT DEATH -> Triggers triggerExplosion in update()
            spawnDamageText(o.x, o.y, "CRIT!", "#ff0000", true);
            playSound('clash');
        }
    }

                        // Calculate collision response (bounce off)
                        let dotProduct = e.vx * tx + e.vy * ty;
                        
                        // Reflect velocity
                        e.vx -= 2 * dotProduct * tx * WALL_BOUNCE;
                        e.vy -= 2 * dotProduct * ty * WALL_BOUNCE;

                        // Deal small damage to obstacle for melee units
                        if (e.type !== 'turret') {
                             o.hp -= 0.5;
                             spawnParticles(e.x, e.y, '#777', 1);
                        }
                        
                        // NEW: WALL SLAM DAMAGE for Unarmed
                        // If entity was recently pushed by an Unarmed fighter and hits an obstacle hard, deal bonus damage
                        if (e.lastPushedBy && e.pushTimer > 0 && Math.abs(dotProduct) > 3) {
                            let pusher = entities.find(p => p.id === e.lastPushedBy);
                            if (pusher) {
                                damageEntity(e, 25, e.x, e.y, pusher); // Huge Wall Slam Damage
                                spawnParticles(e.x, e.y, 'white', 15);
                                playSound('clash');
                                // Reset tracker so they don't get slammed twice instantly
                                e.lastPushedBy = null;
                            }
                        }

                        // SPIKE LOGIC (Damage Reflection)
                        if (o.type === 'spike') {
                            damageEntity(e, 8, e.x, e.y, null);
                            e.lastAttackerId = 'spike';
                            spawnParticles(e.x, e.y, 'red', 5);
                            playSound('hit');
                        }

                        // Prevent tunneling by setting minimum separation velocity
                        if (e.vx * tx + e.vy * ty < 0) { // If moving into obstacle
                             e.vx -= tx * 0.5; e.vy -= ty * 0.5; // push slightly away
                        }
                    }
                });
            });

            entities.forEach(attacker => {
               // 1. Vampire Bat Form can't attack
                if (attacker.type === 'vampire' && attacker.isBat) return; 
                
                // 2. Dancing (Bard) units can't attack
                if (attacker.isDancing) return; 
                
                // 3. INCAPACITATED CHECK: Stunned, Held, Trapped, or Hooked units cannot attack
                if (attacker.frozen > 0 || attacker.heldBy || attacker.trappedBy || attacker.grappledBy) return;


                // --- SPATIAL MELEE ATTACK (Updated) ---
                if (attacker.type === 'spatial') {
                     entities.forEach(victim => {
                        if (attacker.team !== victim.team) {
                            let d = Math.sqrt((attacker.x - victim.x)**2 + (attacker.y - victim.y)**2);
                            if (d < attacker.radius + victim.radius + 5) {
                                let dmg = 1.0;
                                let force = 1.5;
                                
                                // Bonus Damage if Slamming a target in the queue
                                if (attacker.slamTargets.includes(victim.id)) {
                                    dmg = 3.5; // Massive Slam Damage
                                    force = 5.0; 
                                    
                                    // Remove from queue so he targets the next guy
                                    attacker.slamTargets = attacker.slamTargets.filter(id => id !== victim.id);
                                    
                                    victim.frozen = 0; // Break the freeze on impact
                                    victim.isPortalTrapped = false;
                                    playSound('explosion');
                                    spawnParticles(victim.x, victim.y, 'cyan', 15);
                                    triggerHitStop(8);
                                }
                                
                                damageEntity(victim, dmg, attacker.x, attacker.y, attacker);
                                victim.vx += Math.cos(attacker.angle) * force; 
                                victim.vy += Math.sin(attacker.angle) * force;
                            }
                        }
                     });
                }
                // --- END SPATIAL MELEE ATTACK ---

                entities.forEach(victim => {
                    // Friendly Fire Check (Permitted if Paranoid)
                    if (attacker.team === victim.team && !attacker.isParanoid && GAME_MODE !== 'ffa') return;
                    if (attacker.id === victim.id) return; // Don't hit self with sword

                     if (attacker.type === 'adapto' && attacker.currentMode === 'sword') {
            let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach;
            let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
            // Check if sword tip hits victim
            if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 10) {
                damageEntity(victim, 1.3, tipX, tipY, attacker); // Moderate damage
                // Small knockback
                victim.vx += Math.cos(attacker.angle) * 2;
                victim.vy += Math.sin(attacker.angle) * 2;
            }
                }

                    if (attacker.type === 'knight') {
                         let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach; let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                         if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 10) {
                             let mult = 1.5; if (attacker.isRamming) mult = 3.0; 
                             damageEntity(victim, mult, tipX, tipY, attacker);
                             let force = 3; if (attacker.isRamming) { force = 8; attacker.isRamming = false; }
                             victim.vx += Math.cos(attacker.angle) * force; victim.vy += Math.sin(attacker.angle) * force;
                        }
                    }
                    if (attacker.type === 'pirate') { 
                         let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach; let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                         if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 5) {
                             damageEntity(victim, 1.2, tipX, tipY, attacker); victim.vx += Math.cos(attacker.angle) * 1; victim.vy += Math.sin(attacker.angle) * 1;
                        }
                    }
                    if (attacker.type === 'rogue') { 
                         let tipX = attacker.x + Math.cos(attacker.angle) * 34; let tipY = attacker.y + Math.sin(attacker.angle) * 34;
                         if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 8) {
                             damageEntity(victim, attacker.isStealthed ? 1.35 : 1.0, tipX, tipY, attacker);
                         }
                    }

                    if (attacker.type === 'trapper') {
                         let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach;
                         let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                         if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 9) {
                             const trapBonus = (victim.trappedBy === attacker.id || victim.frozen > 0) ? 1.8 : 1.0;
                             damageEntity(victim, 2.2 * trapBonus, tipX, tipY, attacker);
                             victim.vx += Math.cos(attacker.angle) * 1.0;
                             victim.vy += Math.sin(attacker.angle) * 1.0;
                         }
                    }
                    

                    // fight knight LOGIC
                    if (attacker.type === 'fight knight') {
                        // 1. RAM IMPACT (High Knockback)
                        if (attacker.isRamming) {
                            let d = Math.sqrt((attacker.x - victim.x)**2 + (attacker.y - victim.y)**2);
                            if (d < attacker.radius + victim.radius + 15) {
                                damageEntity(victim, 15, attacker.x, attacker.y, attacker);
                                // Knight-style massive push
                                let force = 15;
                                victim.vx += Math.cos(attacker.angle) * force; 
                                victim.vy += Math.sin(attacker.angle) * force;
                                attacker.isRamming = false; // Stop on hit
                                playSound('hit');
                                spawnParticles(victim.x, victim.y, 'white', 10);
                            }
                        }
                        // 2. SPIN CLEAVE (Scythe Logic)
                        // Uses spinTimer to deal damage in a circle
                        else if (attacker.spinTimer > 0) {
                             let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach;
                             let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                             
                             // Hit check: If distance to victim is less than Reach + Radius
                             let d = Math.sqrt((attacker.x - victim.x)**2 + (attacker.y - victim.y)**2);
                             if (d < attacker.reach + victim.radius) {
                                 damageEntity(victim, 2.5, tipX, tipY, attacker); // Heavy Tick Damage
                                 
                                 // Pull them in slightly (vacuum effect) or push out? Scythe pushes perpendicular.
                                 // Let's do chaotic knockback
                                 victim.vx += Math.cos(attacker.angle) * 5;
                                 victim.vy += Math.sin(attacker.angle) * 5;
                             }
                        }
                        // 3. NORMAL SWING (Fallback)
                        else {
                            let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach;
                            let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                            if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 20) {
                                damageEntity(victim, 1.8, tipX, tipY, attacker);
                            }
                        }
                    }
                    // LANCE LOGIC (Buffed Knockback)
                    if (attacker.type === 'lance') {
                        let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach; let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                        if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 5) {
                            damageEntity(victim, 1.0, tipX, tipY, attacker); 
                            // Strong Knockback (6.0 force)
                            victim.vx += Math.cos(attacker.angle) * 6.0; 
                            victim.vy += Math.sin(attacker.angle) * 6.0;
                        }
                    }

                    // BARD LOGIC: song first, attack second
                    if (attacker.type === 'bard') {
                        let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach; let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                        if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 5) {
                            if (victim.isDancing || victim.isParanoid) {
                                damageEntity(victim, 1.25, tipX, tipY, attacker);
                                victim.vx += Math.cos(attacker.angle) * 1.5;
                                victim.vy += Math.sin(attacker.angle) * 1.5;
                            } else {
                                victim.danceTimer = Math.max(victim.danceTimer || 0, 60);
                                victim.isDancing = true;
                                spawnParticles(victim.x, victim.y, 'magenta', 3, 'note');
                            }
                        }
                    }

                    if (attacker.type === 'samurai') {
    let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach;
    let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;

    if (Math.sqrt((tipX - victim.x) ** 2 + (tipY - victim.y) ** 2) < victim.radius + 8) {
        // Small normal poke. Dash ability is still the big damage.
        if (frameCount % 8 === 0) {
            damageEntity(victim, 1.4, tipX, tipY, attacker);
            victim.vx += Math.cos(attacker.angle) * 1.2;
            victim.vy += Math.sin(attacker.angle) * 1.2;
            if (typeof playSound === 'function') playSound('slash', 0.45);
        }
    }
}

                    if (attacker.type === 'scythe') {
                        let tipX = attacker.x + Math.cos(attacker.angle) * attacker.reach; let tipY = attacker.y + Math.sin(attacker.angle) * attacker.reach;
                        if (Math.sqrt((tipX - victim.x)**2 + (tipY - victim.y)**2) < victim.radius + 15) {
                            damageEntity(victim, 2.0, tipX, tipY, attacker); victim.vx -= Math.cos(attacker.angle) * 0.5; victim.vy -= Math.sin(attacker.angle) * 0.5;
                        }
                    }
                    
                    // BOID ATTACK (Swarm)
                    if (attacker.type === 'boid') {
                        if (Math.sqrt((attacker.x - victim.x)**2 + (attacker.y - victim.y)**2) < attacker.radius + victim.radius + 5) {
                            // Only attack every few frames to avoid rapid fire death
                            if (frameCount % 10 === 0) {
                                damageEntity(victim, 1.5, attacker.x, attacker.y, attacker);
                            }
                        }
                    }
                });
            });

            projectiles.forEach(p => {
                if (p.dead) return;

               // --- PROJECTILE VS OBSTACLE COLLISION: SHATTER + BARREL LOGIC ---
obstacles.forEach(o => {
    if (p.dead) return;
    if (o.type === 'lava' || o.type === 'ice' || o.type === 'black_hole') return;

    let d = Math.sqrt((p.x - o.x) ** 2 + (p.y - o.y) ** 2);
    let rad = o.radius + 5;

    if (d < rad) {
        const shooter = entities.find(ent => ent.id === p.shooterId);

        if (p.type === 'spear' && typeof handleSpearObstacleImpact === 'function') {
            if (handleSpearObstacleImpact(p, o, shooter)) return;
        }

        // Bullets/cannonballs shatter on rocks, spikes, and barricades.
        if (
            isShatterProjectile(p) &&
            (o.type === 'rock' || o.type === 'spike' || o.type === 'wall_trap')
        ) {
            let obstacleDamage = p.type === 'cannonball' ? 38 : 4;

            if (o.type === 'spike') obstacleDamage *= 0.4;

            o.hp -= obstacleDamage;
            shatterProjectile(p, o.type);
            return;
        }

        // Barrel logic stays explosive.
        let dmg = 4;

        if (o.type === 'barrel' && shooter && shooter.type === 'adapto') {
            dmg = 80;
        }

        if (
            o.type === 'barrel' &&
            (p.type === 'cannonball' || p.type === 'fireball' || p.type === 'flaming_arrow')
        ) {
            dmg = 80;
        }

        if (o.type === 'barrel') {
            o.hp -= dmg;
            p.dead = true;

            if (p.type === 'cannonball') {
                spawnCannonImpactBurst(p.x, p.y, 1.15);
            } else {
                spawnParticles(p.x, p.y, '#ffcc00', 5);
                playSound('explosion_small');
            }

            return;
        }

        // Fallback for other projectile/obstacle cases.
        o.hp -= dmg * 0.5;
        p.dead = true;
        spawnParticles(p.x, p.y, '#333', 6);
        playSound('clash', 0.5);
        return;
    }
});
// --- END PROJECTILE VS OBSTACLE COLLISION ---

                entities.forEach(e => {
    if (p.dead) return;
    if (e.team === p.team) return;

    let d = Math.sqrt((p.x - e.x) ** 2 + (p.y - e.y) ** 2);
    let rad = e.radius + (p.type === 'orb' ? 5 : 0) + (p.type === 'fireball' || p.type === 'cannonball' ? 20 : 0);

    if (d < rad) {
        // Sticky arrow visual
        if ((p.type === 'arrow' || p.type === 'flaming_arrow') && e.type !== 'turret') {
            let arrowVelocityAngle = Math.atan2(p.vy, p.vx);
            let relativeAngle = arrowVelocityAngle - e.angle;
            
            if (!e.stuckArrows) e.stuckArrows = [];
            e.stuckArrows.push({
                angle: relativeAngle,
                stickDepth: Math.random() * 5,
                life: 300,
                type: p.type
            });
        }

        let damageSource = null;
if (p.shooterId) damageSource = entities.find(a => a.id === p.shooterId);

if (damageSource && (p.type === 'bullet' || p.type === 'cannonball' || p.type === 'arrow' || p.type === 'flaming_arrow' || p.type === 'orb')) {
    recordShotHit(damageSource);
}

        if (p.type === 'potion') {
            explodePotion(p);
            return;
        }

        if (p.type === 'flashbang') {
            explodeFlashbang(p);
            return;
        }

        if (p.type === 'flaming_arrow') {
            explodeFlamingArrow(p);
            return;
        }

        if (p.type === 'hook') return;

        if (p.type === 'water') {
            damageEntity(e, 5.5, p.x, p.y, damageSource);
            e.vx += p.vx * 0.55;
            e.vy += p.vy * 0.55;
            spawnParticles(p.x, p.y, '#81ecec', 5);
            p.dead = true;
            return;
        }

        if (p.type === 'fish') {
            // Fish are no longer one-frame bullets.
            // They either get blocked and swarm, get swatted, or latch on and chew for a few seconds.
            if (p.latchedTargetId) return;

            if (typeof isFishBlockedByTarget === 'function' && isFishBlockedByTarget(p, e)) {
                setFishSwarmBlocked(p, e);
                return;
            }

            const canDefend =
                e.hp > 0 &&
                !e.isDancing &&
                !e.frozen &&
                !e.trappedBy;

            const armedDefender = ['samurai', 'scythe', 'knight', 'lance', 'pirate', 'rogue', 'trapper', 'bard', 'fight knight', 'spearer'].includes(e.type);
            const swatChance = armedDefender ? 0.34 : 0.16;

            if (canDefend && Math.random() < swatChance) {
                p.dead = true;
                spawnParticles(p.x, p.y, '#b2bec3', 8);
                spawnDamageText(p.x, p.y - 18, 'FISH KILLED', '#b2bec3');
                if (typeof playSound === 'function') playSound('clash', 0.25);
                return;
            }

            p.latchedTargetId = e.id;
            p.latchTimer = 150;
            p.biteTick = 0;
            p.radius = 6;
            p.vx = 0;
            p.vy = 0;
            p.life = Math.max(p.life || 0, 160);

            damageEntity(e, 3.0, p.x, p.y, damageSource);
            spawnParticles(e.x, e.y, '#00cec9', 10);
            spawnDamageText(e.x, e.y - 24, 'LATCH!', '#00cec9', true);
            if (typeof playSound === 'function') playSound('hit', 0.35);
            return;
        }

        if (p.type === 'spear') {
            if (typeof handleSpearProjectileHit === 'function') {
                handleSpearProjectileHit(p, e, damageSource);
            } else {
                damageEntity(e, 14, p.x, p.y, damageSource);
                p.dead = true;
            }
            return;
        }

        // Mine explosion logic
        if (p.isMine) {
            if (e.id === p.ownerId || e.team === p.team) return;

            entities.forEach(e_aoe => {
                if (e_aoe.team !== p.team && e_aoe.id !== p.ownerId) {
                    let dist_aoe = Math.sqrt((e_aoe.x - p.x) ** 2 + (e_aoe.y - p.y) ** 2);

                    if (dist_aoe < 150) {
                        e_aoe.isKilledByMine = true;
                        damageEntity(e_aoe, 100, p.x, p.y, damageSource);
                        e_aoe.vx += (e_aoe.x - p.x) * 0.1;
                        e_aoe.vy += (e_aoe.y - p.y) * 0.1;
                    }
                }
            });

            playSound('explosion');
            spawnParticles(p.x, p.y, 'red', 30);
            p.dead = true;
            return;
        }

        let dmg = 12;
        let pauseTime = 0;
        let knockbackMult = 0.2;

        if (p.type === 'bullet') {
            dmg = 4;
            pauseTime = 5;
            knockbackMult = 1.2;
        }

        if (p.type === 'fireball') {
            dmg = 60;
            playSound('explosion');
            spawnParticles(p.x, p.y, 'orange', 20);
            spawnParticles(p.x, p.y, 'red', 8);
        }

        if (p.type === 'cannonball') {
            dmg = 60;
            knockbackMult = 0.75;
            spawnCannonImpactBurst(p.x, p.y, 1.25);
        }

        if (p.type === 'orb') {
            dmg = 25;
            e.frozen = 60;
            spawnParticles(e.x, e.y, 'cyan', 15);
            playSound('zap');
        }

        if (pauseTime > 0) triggerHitStop(pauseTime);

        damageEntity(e, dmg, p.x, p.y, damageSource);

        e.vx += p.vx * knockbackMult;
        e.vy += p.vy * knockbackMult;

        p.dead = true;
    }
});
            });
        }

        function shootHook(e, target) {
            playSound('shot'); 
            let angle = Math.atan2(target.y - e.y, target.x - e.x);
            projectiles.push({
                x: e.x, y: e.y,
                vx: Math.cos(angle) * 9, // SLOWER SPEED (was 15)
                vy: Math.sin(angle) * 9, // SLOWER SPEED (was 15)
                team: e.team, life: 45, type: 'hook', // Increased life slightly to compensate for speed
                shooterId: e.id
            });
        }

        function applyZapDamage(wizard, victim) {
            // 1. Play sound occasionally
            if (frameCount % 4 === 0) playSound('zap');
            
            // 2. Primary Hit Damage (The direct target)
            victim.hp -= 0.3; 
            victim.vx *= 0.7; // Slow them down
            victim.vy *= 0.7; 
            victim.flashTime = 2;
            spawnParticles(victim.x, victim.y, 'cyan', 1);
            victim.lastAttackerId = wizard.id;

            // 3. START THE CHAIN (Branching Tree)
            // We only trigger the chain every 8 frames to prevent lagging the game
            if (frameCount % 8 === 0) {
                // [wizard.id, victim.id] ensures we don't zap the wizard or the same victim twice
                let visited = [wizard.id, victim.id]; 
                
                // Start a chain with 2 jumps remaining
                chainLightning(victim, wizard.team, 2, visited); 
            }
        }

        // Helper: Recursive Chain Logic
        function chainLightning(source, team, jumpsLeft, visited) {
            if (jumpsLeft <= 0) return; // Stop if we ran out of jumps

            let range = 180; // How far the lightning can jump
            
            // Find nearby enemies to branch to
            let candidates = entities.filter(e => 
                e.team !== team &&         // Enemy team
                e.hp > 0 &&                // Alive
                !visited.includes(e.id) && // Hasn't been hit in this chain yet
                Math.sqrt((e.x - source.x)**2 + (e.y - source.y)**2) < range
            );

            // Sort by distance (closest first) and pick up to 2 targets to branch to
            candidates.sort((a, b) => {
                let d1 = (a.x - source.x)**2 + (a.y - source.y)**2;
                let d2 = (b.x - source.x)**2 + (b.y - source.y)**2;
                return d1 - d2;
            });
            
            // "Branching": Pick top 2 closest neighbors
            let nextTargets = candidates.slice(0, 2); 

            nextTargets.forEach(target => {
                // Add to visited list so we don't hit them again in this specific loop
                visited.push(target.id);

                // DAMAGE THE CHAIN TARGET
                target.hp -= 5; // Flat damage chunk
                target.flashTime = 5;
                target.lastAttackerId = source.id; // It chains FROM the previous victim

                // VISUALS
                drawLightningBolt(source, target);

                // RECURSE: Tell this target to shoot lightning at *its* neighbors
                chainLightning(target, team, jumpsLeft - 1, visited);
            });
        }

        // Helper: Draw lines using particles
        function drawLightningBolt(start, end) {
            let dist = Math.sqrt((end.x - start.x)**2 + (end.y - start.y)**2);
            let steps = dist / 15; // One particle every 15px
            
            for(let i = 0; i < steps; i++) {
                let t = i / steps;
                
                // Linear Interpolation (Point between start and end)
                let x = start.x + (end.x - start.x) * t;
                let y = start.y + (end.y - start.y) * t;
                
                // Add Jitter (Randomness) so it looks like electricity
                x += (Math.random() - 0.5) * 15;
                y += (Math.random() - 0.5) * 15;

                spawnParticles(x, y, 'cyan', 1);
            }
        }

        function pointToLineDist(px, py, x1, y1, x2, y2) {
            var A = px - x1; var B = py - y1; var C = x2 - x1; var D = y2 - y1;
            var dot = A * C + B * D; var len_sq = C * C + D * D;
            var param = -1;
            if (len_sq != 0) param = dot / len_sq;
            var xx, yy;
            if (param < 0) { xx = x1; yy = y1; } else if (param > 1) { xx = x2; yy = y2; } else { xx = x1 + param * C; yy = y1 + param * D; }
            var dx = px - xx; var dy = py - yy;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function fireLaser(e) {
    let dmg = 0.5;
    let width = 0.15;
    let knockbackForce = 1.2;
    let beamColor = e.color || 'red';

    if (e.laserMode === 'short') {
        dmg = 0.22;
        width = 0.11;
        knockbackForce = 1.0;
    }

    if (e.laserMode === 'medium') {
        dmg = 0.7;
        width = 0.18;
        knockbackForce = 1.65;
    }

    if (e.laserMode === 'death') {
        dmg = 3.6;
        width = 0.42;
        knockbackForce = 4.6;
        beamColor = '#ff1744';

        if (e.timer % 10 === 0) {
            registerBigMoment(e.x + Math.cos(e.angle) * 170, e.y + Math.sin(e.angle) * 170, 'DEATH LASER', 'boom');
            triggerSlowMoBigHit(18);
        }
    }

    e.laserColor = beamColor;
    e.laserWidth = width;

    let enemies = entities.filter(ent =>
        isValidEnemyTarget(e, ent) &&
        hasLineOfSight(e, ent)
    );

    if (enemies.length === 0) {
        return;
    }

    enemies.forEach(victim => {
        let dx = victim.x - e.x;
        let dy = victim.y - e.y;
        let angleToVictim = Math.atan2(dy, dx);
        let angleDiff = Math.abs(e.angle - angleToVictim);

        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

        const victimDist = Math.sqrt(dx * dx + dy * dy);
        const distanceFalloff = e.laserMode === 'death' ? clamp(1.15 - victimDist / 1200, 0.55, 1.0) : 1;

        if (angleDiff < width) {
            if (e.timer % 20 === 0) {
                registerBigMoment(victim.x, victim.y, e.laserMode === 'death' ? 'DEATH LASER HIT' : 'LASER HIT', e.laserMode === 'death' ? 'boom' : 'hit');
                triggerSlowMoBigHit(e.laserMode === 'death' ? 25 : 14);
            }

            const finalDmg = dmg * distanceFalloff;
            recordDamageForRecap(e, victim, finalDmg);
            victim.lastAttackerId = e.id;
            victim.hp -= finalDmg;

            victim.vx += Math.cos(angleToVictim) * knockbackForce * distanceFalloff;
            victim.vy += Math.sin(angleToVictim) * knockbackForce * distanceFalloff;

            if (e.laserMode === 'death') {
                victim.flashTime = 5;
                victim.frozen = Math.max(victim.frozen || 0, 5);
            }

            if (e.timer % 4 === 0) {
                spawnParticles(victim.x, victim.y, beamColor, e.laserMode === 'death' ? 5 : 2);
                damageEntity(victim, 0, victim.x, victim.y, e);
            }
        }
    });
}
        function closeResultModal() {
            document.getElementById('resultModal').style.display = 'none';
        }
        


        // NEW: Flaming Arrow Shot
        function shootFlamingArrow(e) {
            playSound('flaming_arrow'); 
                        recordShot(e);
            projectiles.push({
                x: e.x, y: e.y,
                vx: Math.cos(e.angle) * 14, // Slightly faster than normal
                vy: Math.sin(e.angle) * 14,
                team: e.team, life: 120, type: 'flaming_arrow',
                shooterId: e.id 
            });
            // Flash color to indicate special use
            spawnParticles(e.x, e.y, 'orange', 10);
        }

        function shootArrow(e) {
            playSound('arrow');
                        recordShot(e);
            for(let i = -1; i <= 1; i++) {
                let spread = i * 0.2; 
                projectiles.push({
                    x: e.x, y: e.y,
                    vx: Math.cos(e.angle + spread) * 12,
                    vy: Math.sin(e.angle + spread) * 12,
                    team: e.team, life: 120, type: 'arrow',
                    shooterId: e.id // ADDED shooterId
                });
            }
        }
        
       function shootBullet(e) {
    playSound('shot');
        recordShot(e);

    const aim = e.angle + randRange(-(e.aimError || 0), (e.aimError || 0));

    spawnMuzzleFlash(e, aim, 'bullet');

    let spawnX = e.x + Math.cos(aim) * (e.radius + 5);
    let spawnY = e.y + Math.sin(aim) * (e.radius + 5);
    
    projectiles.push({
        x: spawnX,
        y: spawnY,
        vx: Math.cos(aim) * 15,
        vy: Math.sin(aim) * 15,
        team: e.team,
        life: 60,
        type: 'bullet',
        shooterId: e.id,
        trail: []
    });
}
        
        function shootCannon(e) {
    playSound('cannon');
        recordShot(e);

    const aim = e.angle + randRange(-0.08, 0.08) * BATTLE_CHAOS;

    spawnMuzzleFlash(e, aim, 'cannon');

    projectiles.push({
        x: e.x + Math.cos(aim) * (e.radius + 8),
        y: e.y + Math.sin(aim) * (e.radius + 8),
        vx: Math.cos(aim) * 10,
        vy: Math.sin(aim) * 10,
        team: e.team,
        life: 200,
        type: 'cannonball',
        shooterId: e.id,
        trail: []
    });
}
        
        function shootOrb(e) {
            e.orbCount--;
            playSound('laser_fire_burst');
            // Attach target to projectile for tracking
            projectiles.push({
                x: e.x, y: e.y,
                vx: Math.cos(e.angle) * 8,
                vy: Math.sin(e.angle) * 8,
                team: e.team, life: 300, type: 'orb',
                target: e.target,
                shooterId: e.id // ADDED shooterId
            });
        }

        function getFighterLocalPoint(e, localX, localY) {
    const angle = e.angle || 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return {
        x: e.x + localX * cos - localY * sin,
        y: e.y + localX * sin + localY * cos
    };
}

       function draw() {
    const isDark = document.body.classList.contains('dark-mode');

    // 1. Clear Screen (Use Identity Matrix to ensure full clear)
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- TOURNAMENT BRACKET VIEW ---
if (GAME_MODE === 'tournament' && !isTournamentMatch && tournamentData.active) {
    // 1. Background Setup
    ctx.fillStyle = isDark ? '#1a1a1a' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    let rounds = tournamentData.matches;
    
    // 2. Calculate Global Scaling Factors
    // Divide width by number of rounds + 0.5 for margin
    let colWidth = canvas.width / (rounds.length + 0.5); 
    
    // Standardize box proportions: 80% of column width, capped at a reasonable max
    let boxWidth = Math.min(colWidth * 0.8, 220); 
    // Height is a ratio of width to keep boxes uniform (1:4 ratio)
    let boxHeight = boxWidth * 0.25; 
    // Font size scales with box height (45% of height)
    let fontSize = Math.max(10, Math.floor(boxHeight * 0.45)); 

    rounds.forEach((round, rIndex) => {
        // Horizontal distribution: Center columns within the calculated colWidth
        let x = (rIndex + 0.25) * colWidth;
        let rowHeight = canvas.height / round.length;
        
        round.forEach((match, mIndex) => {
            // Vertical distribution: Perfectly centered in their allotted row height
            let y = (mIndex + 0.5) * rowHeight;
            
            // Draw Connector Lines first (so they appear behind boxes)
            if (rIndex < rounds.length - 1) {
                let parentIndex = Math.floor(mIndex / 2);
                let nextRowHeight = canvas.height / (rounds[rIndex + 1].length);
                let nextY = (parentIndex + 0.5) * nextRowHeight;
                let nextX = (rIndex + 1.25) * colWidth;
                
                ctx.beginPath();
                ctx.moveTo(x + boxWidth, y);
                ctx.lineTo(nextX, nextY);
                ctx.strokeStyle = isDark ? '#444' : '#ccc';
                ctx.lineWidth = Math.max(2, canvas.width / 800);
                ctx.stroke();
            }

            // Draw Box
            ctx.fillStyle = isDark ? '#333' : '#fff';
            ctx.strokeStyle = isDark ? '#666' : '#000';
            ctx.lineWidth = Math.max(1, canvas.width / 1200);
            
            // Draw shadow for readability
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 4;
            ctx.fillRect(x, y - (boxHeight / 2), boxWidth, boxHeight);
            ctx.shadowBlur = 0; // Reset shadow for stroke
            
            ctx.strokeRect(x, y - (boxHeight / 2), boxWidth, boxHeight);
            
            // Draw Text
            ctx.fillStyle = isDark ? '#eee' : '#111';
            ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Determine display text
            let txt = match.winner ? match.winner.name : `${match.p1.name} VS ${match.p2.name}`;
            
            // Truncate text if it's too long for the box
            let maxWidth = boxWidth * 0.9;
            if (ctx.measureText(txt).width > maxWidth) {
                while (ctx.measureText(txt + "...").width > maxWidth && txt.length > 0) {
                    txt = txt.slice(0, -1);
                }
                txt += "...";
            }

            // Highlight current active match
            let isCurrent = !match.winner && rIndex === tournamentData.round && 
                            tournamentData.matches[rIndex].indexOf(match) === 
                            tournamentData.matches[rIndex].findIndex(m => m.winner === null);
            
            if (isCurrent) {
                ctx.fillStyle = 'gold';
                ctx.shadowColor = 'gold';
                ctx.shadowBlur = 10;
                ctx.strokeRect(x, y - (boxHeight / 2), boxWidth, boxHeight);
                ctx.shadowBlur = 0;
            }
            
            ctx.fillText(txt, x + (boxWidth / 2), y);
        });
    });
    
    return; // Prevents the rest of the draw loop from running
}

    // 2. Apply Camera Transform
    ctx.save(); // Start Camera State
    
    // Move to center -> Scale -> Move back by Camera Position
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // --- NEW: DRAW ARENA BACKGROUND ---
    let arenaColor;
    
    if (ARENA_THEME === 'desert') {
        arenaColor = isDark ? '#8B4513' : '#F4A460'; // Sandy Brown
    } else if (ARENA_THEME === 'mud') {
        arenaColor = isDark ? '#3E2723' : '#8D6E63'; // Muddy Brown
    } else if (ARENA_THEME === 'snow') {
        arenaColor = isDark ? '#78909C' : '#F0F8FF'; // Alice Blue / Blue Grey
    } else {
        // Standard White/Dark
       arenaColor = isDark ? '#333333' : '#ffffff';
    }

    ctx.fillStyle = arenaColor;
    // Draw a giant rectangle covering the map area
    // We draw slightly larger than the canvas to ensure camera shake doesn't show edges
    ctx.fillRect(-1000, -1000, canvas.width + 4000, canvas.height + 4000);
    // -----------------------------------

    decals.forEach(d => {
        ctx.save();
        ctx.globalAlpha = d.alpha; // Transparency
        ctx.fillStyle = d.color;
        
        // Draw a slightly irregular circle (ovalish) for style
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.beginPath();
        ctx.ellipse(0, 0, d.radius, d.radius * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    });
    ctx.globalAlpha = 1.0;

    // --- DRAW BORDER (So we know where the arena ends) ---
    ctx.strokeStyle = isDark ? '#555' : '#000';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

   // --- 3. DRAW OBSTACLES ---
    obstacles.forEach(o => {
        ctx.save();
        ctx.translate(o.x, o.y);

        if (o.type === 'lava') {
            let pulse = Math.sin(frameCount * 0.1) * 2;
            ctx.fillStyle = `rgba(255, 69, 0, 0.6)`;
            ctx.beginPath();
            ctx.arc(0, 0, o.radius + pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ff8c00';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // FIX: Use Global coordinates (o.x + offset) for particles, 
            // because spawnParticles pushes to the global array.
            if (frameCount % 20 === 0) {
                spawnParticles(
                    o.x + (Math.random()-0.5)*o.radius, 
                    o.y + (Math.random()-0.5)*o.radius, 
                    '#ffcc00', 1
                );
            }
        } 

        else if (o.type === 'barrel') {
    ctx.save();

    if (o.tactical || o.skin === 'adapto_tactical') {
        // Adapto tactical barrel: grey compact charge, visually different from red arena barrels.
        ctx.fillStyle = '#6f7a83';
        ctx.strokeStyle = '#23272a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-o.radius, -o.radius * 0.75, o.radius * 2, o.radius * 1.5, 5);
        else ctx.rect(-o.radius, -o.radius * 0.75, o.radius * 2, o.radius * 1.5);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-o.radius * 0.7, -o.radius * 0.35);
        ctx.lineTo(o.radius * 0.7, -o.radius * 0.35);
        ctx.moveTo(-o.radius * 0.7, o.radius * 0.35);
        ctx.lineTo(o.radius * 0.7, o.radius * 0.35);
        ctx.stroke();

        ctx.fillStyle = '#1b1f23';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 0.35, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', 0, 0);
    } else {
        // Regular arena barrel
        ctx.fillStyle = '#C0392B';
        ctx.strokeStyle = '#5c1e16';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, o.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#F1C40F';
        ctx.beginPath(); ctx.arc(0, 0, o.radius * 0.5, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = 'black';
        ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
    }

    const hpRatio = o.hp / o.maxHp;
    if (hpRatio < 0.5) { 
        ctx.strokeStyle = 'black'; 
        ctx.beginPath(); ctx.moveTo(-5, -10); ctx.lineTo(5, -5); ctx.stroke(); 
    }
    ctx.restore();
}
        else if (o.type === 'ice') {
            ctx.fillStyle = 'rgba(200, 240, 255, 0.6)';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, o.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // Glimmer
            ctx.fillStyle = 'white'; ctx.globalAlpha = 0.6 + Math.sin(frameCount * 0.1) * 0.2;
            ctx.beginPath(); ctx.arc(-o.radius*0.4, -o.radius*0.4, 8, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1.0;
        } 
        else if (o.type === 'spike') {
            ctx.fillStyle = '#444'; ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, o.radius - 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // Spikes
            for (let i = 0; i < 8; i++) {
                let angle = (i / 8) * Math.PI * 2;
                let sx = Math.cos(angle) * o.radius;
                let sy = Math.sin(angle) * o.radius;
                ctx.beginPath();
                ctx.moveTo(Math.cos(angle - 0.2) * (o.radius-5), Math.sin(angle - 0.2) * (o.radius-5));
                ctx.lineTo(sx, sy);
                ctx.lineTo(Math.cos(angle + 0.2) * (o.radius-5), Math.sin(angle + 0.2) * (o.radius-5));
                ctx.fill();
            }
        } 

        else if (o.type === 'wall_trap') {
            // Draw Wooden Barricade
            ctx.save();
            ctx.fillStyle = '#8B4513'; // SaddleBrown
            ctx.strokeStyle = '#3e2723';
            ctx.lineWidth = 2;
            
            // Main Post
            ctx.beginPath(); ctx.arc(0, 0, o.radius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            // X-Brace visual
            ctx.strokeStyle = '#DEB887'; // Burlywood
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(-o.radius*0.6, -o.radius*0.6); ctx.lineTo(o.radius*0.6, o.radius*0.6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(o.radius*0.6, -o.radius*0.6); ctx.lineTo(-o.radius*0.6, o.radius*0.6); ctx.stroke();
            
            ctx.restore();
        }

        else if (o.type === 'black_hole') {
            // Accretion Disk (Glow)
            let pulse = Math.sin(frameCount * 0.2) * 5;
            ctx.beginPath();
            ctx.arc(0, 0, o.radius + 5 + pulse, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(75, 0, 130, 0.5)'; // Indigo Glow
            ctx.fill();

            // The Event Horizon (Black Void)
            ctx.beginPath();
            ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'black';
            ctx.fill();
            
            // White Ring Outline
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Particle Sucking Effect (Visual Only)
            if (frameCount % 5 === 0) {
                // Spawn a particle nearby that gets sucked in
                spawnParticles(o.x + (Math.random()-0.5)*100, o.y + (Math.random()-0.5)*100, 'purple', 1);
            }
        }
        
        else {
            // ROCK
            ctx.fillStyle = '#777'; ctx.strokeStyle = '#555'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, o.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // Damage Cracks
            const hpRatio = o.hp / o.maxHp;
            ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
            if (hpRatio < 0.8) { ctx.beginPath(); ctx.moveTo(-o.radius*0.3, -o.radius*0.3); ctx.lineTo(o.radius*0.5, o.radius*0.5); ctx.stroke(); }
            if (hpRatio < 0.5) { ctx.beginPath(); ctx.moveTo(o.radius*0.2, -o.radius*0.8); ctx.lineTo(-o.radius*0.6, o.radius*0.1); ctx.stroke(); }
        }
        ctx.restore();
    });

    // --- 4. DRAW TRAPS ---
    traps.forEach(t => {
        ctx.save(); ctx.translate(t.x, t.y);
        ctx.strokeStyle = 'brown'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, t.radius, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-t.radius, 0); ctx.lineTo(t.radius, 0); ctx.moveTo(0, -t.radius); ctx.lineTo(0, t.radius); ctx.stroke();
        if (t.trappedEnemyId) { ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    });

    // --- 5. DRAW PORTALS ---
    portals.forEach(p => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.strokeStyle = p.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0,0, 20, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(15, 0); ctx.stroke();
        ctx.restore();
    });

    // --- 6. DRAW ENTITIES (THE FIGHTERS) ---
    entities.forEach(e => {
        // Draw Grapple Chain
        if (e.grappledBy) {
            let g = entities.find(x => x.id === e.grappledBy);
            if(g) { ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(g.x, g.y); ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke(); }
        }

        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle);

        // DRAW CHESS CROWN
            if (e.isKing) {
                ctx.save();
                ctx.fillStyle = 'gold';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                // Draw a simple crown above the unit
                ctx.beginPath();
                ctx.moveTo(-10, -15);
                ctx.lineTo(-5, -25);
                ctx.lineTo(0, -15);
                ctx.lineTo(5, -25);
                ctx.lineTo(10, -15);
                ctx.lineTo(10, -10);
                ctx.lineTo(-10, -10);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }

       // --- 1. CHAMELEON TAIL (Draws for anyone who IS a chameleon, even if transformed) ---
if (e.realType === 'chameleon') {
    ctx.save();
    // Alternating Color Effect (Rainbow shift)
    let hue = (frameCount * 5) % 360;
    e.color = `hsl(${hue}, 70%, 50%)`; // Updates the body color variable for later
    
    // Draw Tail
    ctx.strokeStyle = e.color; 
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, 0); 
    // Curvy tail shape behind the ball
    ctx.bezierCurveTo(-25, 5, -30, 15, -15, 20); 
    ctx.stroke();
    ctx.restore();
}

// --- 2. WEAPONS & ACCESSORIES ---
if (e.type === 'lance') { 
    ctx.fillStyle = '#999'; ctx.strokeStyle = isDark?'#eee':'#000'; ctx.lineWidth=4; 
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(e.reach,0); ctx.stroke(); 
    ctx.beginPath(); ctx.moveTo(e.reach,-6); ctx.lineTo(e.reach+15,0); ctx.lineTo(e.reach,6); ctx.fill(); ctx.stroke(); 
}
else if (e.type === 'scythe') {
    const shaftEnd = Math.max(e.reach || 80, 80);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Shaft
    ctx.strokeStyle = isDark ? '#b2bec3' : '#2d3436';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(shaftEnd, 0);
    ctx.stroke();

    // Handle wrapping
    ctx.strokeStyle = '#6d4c41';
    ctx.lineWidth = 2;
    for (let wrapX = 6; wrapX < 26; wrapX += 7) {
        ctx.beginPath();
        ctx.moveTo(wrapX, -5);
        ctx.lineTo(wrapX + 5, 5);
        ctx.stroke();
    }

    // Blade base
    ctx.fillStyle = '#57606f';
    ctx.beginPath();
    ctx.arc(shaftEnd, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    // Big curved blade, above the pole
    ctx.fillStyle = '#dfe6e9';
    ctx.strokeStyle = isDark ? '#ffffff' : '#2f3542';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shaftEnd - 2, -4);
    ctx.quadraticCurveTo(shaftEnd + 24, -44, shaftEnd + 64, -42);
    ctx.quadraticCurveTo(shaftEnd + 38, -24, shaftEnd + 16, 14);
    ctx.quadraticCurveTo(shaftEnd + 10, 4, shaftEnd - 2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Sharp highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(shaftEnd + 12, -10);
    ctx.quadraticCurveTo(shaftEnd + 30, -34, shaftEnd + 58, -38);
    ctx.stroke();

    ctx.restore();
}
else if (e.type === 'bow') { 
    ctx.strokeStyle = 'brown'; ctx.lineWidth=3; 
    ctx.beginPath(); ctx.arc(15,0,20,1.5*Math.PI,0.5*Math.PI); ctx.stroke(); 
}
else if (e.type === 'fight knight') {
    // Determine visuals based on Attrition Stage
    let armorColor = '#2c3e50'; // Dark Iron
    if (e.resurrectionStage === 1) armorColor = '#546e7a'; // Lighter/Cracked
    if (e.resurrectionStage === 2) armorColor = '#78909c'; // Ripped
    
    // GIANT SLAB SWORD
    ctx.save();
    ctx.fillStyle = '#3e2723'; 
    ctx.fillRect(50, -3, 20, 6); // Handle
    
    // Blade condition degrades
    ctx.fillStyle = armorColor;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    
    // Blade gets chipped/smaller
    let bladeWidth = 28 - (e.resurrectionStage * 5); 
    ctx.beginPath();
    ctx.rect(25, -bladeWidth/2, e.reach, bladeWidth); 
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // BODY / ARMOR VISUALS
    if (e.hasFeigned && e.resurrectionStage < 4) {
        // Draw Armor Helmet
        // If Feigning (Healing), pulse white
        if (e.isFeigning) ctx.fillStyle = `hsl(0, 0%, ${50 + Math.sin(frameCount * 0.2) * 20}%)`; 
        else
        ctx.fillStyle = armorColor;
        ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
        
        // Visor (Gets broken)
        ctx.fillStyle = e.color;
        if (e.resurrectionStage < 2) {
            // Full T-Visor
            ctx.fillRect(8, -2, 10, 4);   
            ctx.fillRect(12, -7, 3, 14);  
        } else {
            // Broken Visor (Single eye)
            ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI*2); ctx.fill();
        }

        // Spikes (Draw if stage < 4)
        ctx.fillStyle = '#999';
        for(let i=0; i<8; i++) {
            let a = (i/8)*Math.PI*2 + frameCount*0.05;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a)*e.radius, Math.sin(a)*e.radius);
            ctx.lineTo(Math.cos(a)*(e.radius+8), Math.sin(a)*(e.radius+8)); // Spike tip
            ctx.lineTo(Math.cos(a+0.2)*e.radius, Math.sin(a+0.2)*e.radius);
            ctx.fill();
        }
    } else {
        // NO ARMOR (Stage 4 - Final Stand)
        // Just a fleshy/damaged body
        ctx.fillStyle = '#d7ccc8'; // Skin tone
        ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
        // Desperate eyes
        ctx.fillStyle = 'black';
        ctx.beginPath(); ctx.arc(8, -4, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(8, 4, 2, 0, Math.PI*2); ctx.fill();
    }
}
else if (e.type === 'knight') { 
    ctx.strokeStyle = '#888'; ctx.lineWidth=4; 
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(e.reach,0); ctx.stroke(); 
    ctx.strokeStyle = 'gold'; ctx.lineWidth=5; 
    ctx.beginPath(); ctx.arc(0,0,30,-1,1); ctx.stroke(); 
}
else if (e.type === 'soldier') { 
    ctx.fillStyle = e.state==='reloading'?'#666':'#333'; 
    ctx.fillRect(10,-5,30,10); 
}
else if (e.type === 'dualist') { 
            ctx.fillStyle = '#111'; // Black Suit
            ctx.fillRect(-10, -10, 20, 20); 
            // Dual Guns
            ctx.fillStyle = '#333';
            ctx.fillRect(10, -8, 25, 6); // Right Gun
            ctx.fillRect(10, 2, 25, 6);  // Left Gun
        }
else if (e.type === 'adapto') {
    if (e.currentMode === 'assess') { 
        // Yellow "Scanning" Eye
        ctx.fillStyle = '#eee'; // Body
        ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill(); 
        ctx.fillStyle = 'yellow'; // Scanning Eye
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (e.currentMode === 'gun') { ctx.fillStyle = '#444'; ctx.fillRect(10, -5, 25, 10); }
    else if (e.currentMode === 'shield') { ctx.strokeStyle = 'cyan'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 25, -1, 1); ctx.stroke(); }
    else { ctx.fillStyle = '#eee'; ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(e.reach, 0); ctx.lineTo(e.reach - 5, -5); ctx.stroke(); }
}
else if (e.type === 'pirate') { 
    if(e.cannonTimer<230){ctx.fillStyle='#aaa';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(40,-5);ctx.lineTo(40,5);ctx.fill();} 
    else {ctx.fillStyle='#222';ctx.fillRect(10,-8,30,16);} 
}
else if (e.type === 'wizard') {
    // Hat
    ctx.fillStyle = 'purple';
    ctx.beginPath();
    ctx.moveTo(-12, -20);
    ctx.lineTo(12, -20);
    ctx.lineTo(0, -52);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#a29bfe';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cyan wand handle
    ctx.strokeStyle = '#00d9ff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = e.isZapping ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(36, -14);
    ctx.stroke();

    // Wand core highlight
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 5);
    ctx.lineTo(34, -12);
    ctx.stroke();

    // Wand tip glow. This local point must match the zap beam's start point.
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(39, -16, 5 + Math.sin(frameCount * 0.25) * 1.5 + (e.isZapping ? 3 : 0), 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
}

else if (e.type === 'binder') {
    // Body
    ctx.fillStyle = '#444'; 
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
    
    // Teeth / Jaws
    ctx.fillStyle = '#fff';
    if (e.boundTargetId) {
        // Biting visual (Closed jaws)
        ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(0, 5); ctx.lineTo(8, -5); ctx.fill();
        ctx.fillStyle = 'red'; // Glowing eye
        ctx.beginPath(); ctx.arc(0, -2, 3, 0, Math.PI*2); ctx.fill();
    } else {
        // Open jaws
        ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-5, 2); ctx.lineTo(0, -8); ctx.lineTo(5, 2); ctx.lineTo(10, -8); ctx.fill();
    }
}

else if (e.type === 'grabber') { 
    ctx.strokeStyle = 'brown'; ctx.lineWidth = 4; 
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(25, 20); ctx.stroke(); 
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(25, -20); ctx.stroke(); 
}
else if (e.type === 'rogue') { 
    ctx.fillStyle = e.isStealthed ? '#ccc' : '#333'; 
    ctx.beginPath(); ctx.moveTo(15,-5); ctx.lineTo(35,0); ctx.lineTo(15,5); ctx.fill(); 
    ctx.beginPath(); ctx.moveTo(-15,5); ctx.lineTo(-35,0); ctx.lineTo(-15,-5); ctx.fill(); 
}
else if (e.type === 'samurai') {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Wrapped handle
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(20, 0);
    ctx.stroke();

    ctx.strokeStyle = '#d63031';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, -3);
    ctx.lineTo(13, 4);
    ctx.moveTo(11, -4);
    ctx.lineTo(19, 3);
    ctx.stroke();

    // Guard
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18, -9);
    ctx.lineTo(18, 9);
    ctx.stroke();

    // Katana blade as a filled curved shape, not a thin line
    ctx.fillStyle = '#dfe6e9';
    ctx.strokeStyle = isDark ? '#ffffff' : '#2f3542';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, -3);
    ctx.quadraticCurveTo(46, -13, 76, -7);
    ctx.lineTo(82, -3);
    ctx.quadraticCurveTo(48, 2, 20, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cutting edge shine
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(26, -4);
    ctx.quadraticCurveTo(50, -10, 76, -6);
    ctx.stroke();

    ctx.restore();
}
else if (e.type === 'engineer') {
    // Helmet
    ctx.fillStyle = '#f39c12';
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -13, 14, Math.PI, 0);
    ctx.lineTo(14, -8);
    ctx.lineTo(-14, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Helmet band
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(-14, -9, 28, 4);

    // Hand-mounted mini turret
    ctx.save();
    ctx.translate(12, 8);
    ctx.fillStyle = '#555';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.fillRect(3, -3, 17, 6);

    ctx.fillStyle = '#00c3ff';
    ctx.beginPath();
    ctx.arc(20, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
else if (e.type === 'bard') { 
    ctx.strokeStyle='#8B4513';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(e.reach,0);ctx.stroke(); 
    ctx.fillStyle='#A0522D';ctx.beginPath();ctx.ellipse(e.reach,0,15,10,0,0,Math.PI*2);ctx.fill(); 
    ctx.fillStyle='#000';ctx.beginPath();ctx.arc(e.reach,0,4,0,Math.PI*2);ctx.fill(); 
}
else if (e.type === 'trapper') { 
    ctx.fillStyle = '#555'; 
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(e.reach,-3); ctx.lineTo(e.reach+5,0); ctx.lineTo(e.reach,3); ctx.lineTo(0,0); ctx.fill(); 
}
else if (e.type === 'spearer') {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Back quiver
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-12, -14);
    ctx.lineTo(12, 16);
    ctx.stroke();

    // Thrown spear in hand
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(55, 0);
    ctx.stroke();

    // Metal spear tip
    ctx.fillStyle = '#dfe6e9';
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(55, -7);
    ctx.lineTo(74, 0);
    ctx.lineTo(55, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Spear tail feathers
    ctx.fillStyle = '#ff7675';
    ctx.beginPath();
    ctx.moveTo(-10, -7);
    ctx.lineTo(-24, -12);
    ctx.lineTo(-17, -1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#74b9ff';
    ctx.beginPath();
    ctx.moveTo(-10, 7);
    ctx.lineTo(-24, 12);
    ctx.lineTo(-17, 1);
    ctx.closePath();
    ctx.fill();

    // Variant hint glow when ready
    if ((e.explosiveSpearCooldown || 0) <= 0) {
        ctx.strokeStyle = 'rgba(255, 118, 117, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 7, -0.7, 0.7);
        ctx.stroke();
    }

    ctx.restore();
}
else if (e.type === 'turret') { 
    ctx.fillStyle = '#555'; ctx.fillRect(-15, -15, 30, 30); 
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill(); 
    ctx.fillStyle = '#222'; ctx.fillRect(0, -5, 25, 10); 
}
else if (e.type === 'aquamarine') {
    ctx.save();
    const pulse = Math.sin(frameCount * 0.14) * 2;
    const spray = e.waterSprayTimer > 0;
    const fishBurst = e.fishBurstTimer > 0;

    // Water aura shell
    ctx.strokeStyle = fishBurst ? '#ffffff' : '#00cec9';
    ctx.lineWidth = fishBurst ? 5 : 4;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = fishBurst ? 14 : 6;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 8 + pulse, -0.75, 0.75);
    ctx.stroke();

    // Wave crest
    ctx.strokeStyle = '#81ecec';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-e.radius * 0.45, -e.radius * 0.70);
    ctx.quadraticCurveTo(-4, -e.radius - 13 - pulse, e.radius * 0.52, -e.radius * 0.55);
    ctx.stroke();

    // Fish familiar symbol beside the body
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#81ecec';
    ctx.strokeStyle = '#006f7a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(e.radius + 18, 0, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00cec9';
    ctx.beginPath();
    ctx.moveTo(e.radius + 3, 0);
    ctx.lineTo(e.radius - 8, -7);
    ctx.lineTo(e.radius - 8, 7);
    ctx.closePath();
    ctx.fill();

    // Water cannon / spray nozzle
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.radius - 2, 4);
    ctx.lineTo(e.radius + 26, 2);
    ctx.stroke();

    if (spray) {
        ctx.strokeStyle = 'rgba(129,236,236,0.85)';
        ctx.lineWidth = 3;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(e.radius + 25, 2);
            ctx.lineTo(e.radius + 62, i * 7);
            ctx.stroke();
        }
    }

    ctx.restore();
}
else if (e.type === 'mammoth') {
    ctx.save();

    // Rider body / saddle marker
    ctx.fillStyle = '#5d4037';
    ctx.strokeStyle = '#2d1f1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fur collar
    ctx.strokeStyle = '#d7ccc8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 8, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // Lance from above
    ctx.strokeStyle = '#f5f5dc';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, -2);
    ctx.lineTo(e.reach + 10, -18);
    ctx.stroke();

    ctx.fillStyle = '#f5f5dc';
    ctx.beginPath();
    ctx.moveTo(e.reach + 13, -19);
    ctx.lineTo(e.reach + 26, -22);
    ctx.lineTo(e.reach + 16, -10);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}
else if (e.type === 'mammoth_mount') {
    ctx.save();

    // Large woolly body
    ctx.fillStyle = '#6d4c41';
    ctx.strokeStyle = '#2d1f1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(-4, 0, e.radius + 14, e.radius + 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Wool cap
    ctx.fillStyle = '#8d6e63';
    ctx.beginPath();
    ctx.ellipse(-12, -e.radius * 0.45, e.radius * 0.7, e.radius * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#795548';
    ctx.strokeStyle = '#2d1f1a';
    ctx.beginPath();
    ctx.ellipse(e.radius * 0.78, 0, e.radius * 0.55, e.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Trunk
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.radius + 10, 0);
    ctx.quadraticCurveTo(e.radius + 32, 8, e.radius + 25, 26);
    ctx.stroke();

    // Tusks
    ctx.strokeStyle = '#f5f5dc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(e.radius + 2, -10);
    ctx.quadraticCurveTo(e.radius + 34, -23, e.radius + 41, -2);
    ctx.moveTo(e.radius + 2, 10);
    ctx.quadraticCurveTo(e.radius + 34, 23, e.radius + 41, 2);
    ctx.stroke();

    // Feet
    ctx.fillStyle = '#3e2723';
    for (let fx of [-22, 3, 24]) {
        ctx.fillRect(fx, e.radius - 2, 9, 8);
    }

    // Eye
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(e.radius + 7, -9, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}
else if (e.type === 'vampire') { 
    if(e.isBat){ctx.fillStyle='#111';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-15,-10);ctx.lineTo(-5,0);ctx.fill();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(15,-10);ctx.lineTo(5,0);ctx.fill();} 
    else {ctx.fillStyle='#800000';ctx.beginPath();ctx.moveTo(-15,5);ctx.lineTo(0,-15);ctx.lineTo(15,5);ctx.fill();} 
}
else if (e.type === 'laser') {
    if (e.isBlocking || e.state === 'blocking') {
        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 8, -1.15, 1.15);
        ctx.stroke();
    } else {
        const laserBeamLength = Math.max(canvas.width, canvas.height) * 2;

        if (e.state === 'charging') {
            ctx.strokeStyle = 'rgba(255,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(laserBeamLength, 0);
            ctx.stroke();
        } else if (e.state === 'firing') {
            ctx.strokeStyle = e.laserColor || 'rgba(255,0,0,0.6)';
            ctx.lineWidth = (e.laserWidth || 0.15) * 100;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(laserBeamLength, 0);
            ctx.stroke();
        }
    }
}
// --- BLOCKING ARMS VISUAL ---
            // Added 'chrono' to this list
else if ((e.type === 'unarmed' || e.type === 'chameleon' || e.type === 'grower' || e.type === 'regenerator' || e.type === 'duplicator' || e.type === 'chrono') && e.isBlocking) {
                
                // Default Size Stats (for Unarmed/Regenerator)
                let armRadius = 8;
                let armSpacingY = 12;
                let armDistX = 10;

                // --- DYNAMIC SCALING FOR GROWER ---
                if (e.type === 'grower') {
                    // Calculate scale ratio relative to a normal fighter (radius ~20)
                    let scale = e.radius / 20; 
                    
                    armRadius = 8 * scale;      // Fists get bigger
                    armSpacingY = 12 * scale;   // Fists move further apart
                    armDistX = 10 * scale;      // Fists move further forward
                }

                ctx.fillStyle = e.color; 
                ctx.strokeStyle = '#000'; 
                ctx.lineWidth = 2;

                // Left Arm
                ctx.beginPath(); 
                ctx.arc(e.radius + armDistX, -armSpacingY, armRadius, 0, Math.PI * 2); 
                ctx.fill(); 
                ctx.stroke();

                // Right Arm
                ctx.beginPath(); 
                ctx.arc(e.radius + armDistX, armSpacingY, armRadius, 0, Math.PI * 2); 
                ctx.fill(); 
                ctx.stroke();
            }
// --- NEW ACCESSORIES ---
else if (e.type === 'duplicator' && e.isOriginal) {
    // Golden Crown
    ctx.fillStyle = '#FFD700'; ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -12); ctx.lineTo(-10, -22); ctx.lineTo(-5, -15);
    ctx.lineTo(0, -25); ctx.lineTo(5, -15); ctx.lineTo(10, -22); ctx.lineTo(10, -12);
    ctx.closePath(); ctx.fill(); ctx.stroke();
}

else if (e.type === 'alchemist') {
    // 1. PLAGUE DOCTOR MASK
    ctx.fillStyle = '#333'; // Dark leather mask
    ctx.beginPath(); 
    ctx.moveTo(8, -8); // Top of beak base
    ctx.lineTo(35, 2); // Tip of beak (Long)
    ctx.lineTo(8, 12); // Bottom of beak base
    ctx.fill(); 
    
    // 2. GLOWING EYE
    ctx.fillStyle = '#ccff00'; 
    ctx.beginPath(); 
    ctx.arc(8, -5, 4, 0, Math.PI*2); 
    ctx.fill();
    
    // 3. HAT RIM
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(0, -12, 18, 4, 0, 0, Math.PI*2);
    ctx.fill();

    // 4. DYNAMIC FLASK (The gameplay indicator)
    // Determine color based on the cycle logic
    let flaskColor = '#9932cc'; // Default Purple (Freeze)
    if (e.potionCycle === 1) flaskColor = '#32cd32'; // Green (Poison)
    if (e.potionCycle === 3) flaskColor = '#ff4500'; // Orange (Blast)
    
    // Draw the Flask
    ctx.save();
    // Moved to (25, 10) so it sits slightly under the beak
    ctx.translate(25, 10); 
    ctx.rotate(Math.sin(frameCount * 0.1) * 0.2); // Animate it bobbing slightly
    
    // Liquid
    ctx.fillStyle = flaskColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); 
    ctx.arc(0, 5, 8, 0, Math.PI*2); // Flask Bulb
    ctx.fill(); 
    ctx.stroke();
    
    // Neck of flask
    ctx.fillStyle = '#ccc'; 
    ctx.fillRect(-3, -8, 6, 8); 
    ctx.restore();
}
else if (e.type === 'chrono') {
    // Orbiting Time Rings (Cyan)
    ctx.strokeStyle = 'cyan'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 8, frameCount * 0.1, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 8, -frameCount * 0.1, 0, Math.PI*2); ctx.stroke();

    // Golden Ring Surrounding Him
    ctx.strokeStyle = 'gold'; ctx.lineWidth = 2;
    ctx.beginPath(); 
    ctx.arc(0, 0, e.radius + 5, 0, Math.PI*2); // Radius slightly larger than body
    ctx.stroke();
}
else if (e.type === 'whispers') {
    // Wind Aura Ring
    ctx.strokeStyle = 'rgba(200, 200, 255, 0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 5, frameCount * 0.2, frameCount * 0.2 + 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 200, 255, 0.4)';
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 8, -frameCount * 0.15, -frameCount * 0.15 + 3); ctx.stroke();
}
else if (e.type === 'devourer') {
    // Teeth / Mouth
    ctx.fillStyle = '#3a0000'; // Dark mouth inside
    ctx.beginPath(); ctx.arc(10, 0, 14, -0.7, 0.7); ctx.fill();
    ctx.fillStyle = 'white'; // Teeth
    ctx.beginPath(); ctx.moveTo(18, -6); ctx.lineTo(14, 0); ctx.lineTo(18, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, -8); ctx.lineTo(14, -4); ctx.lineTo(18, -6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(14, 4); ctx.lineTo(18, 6); ctx.fill();
}

        // Draw BODY
        if (e.type !== 'turret') {
            ctx.beginPath();
            ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
            if (e.flashTime > 0) ctx.fillStyle = '#fff';
            else if (e.frozen > 0 && !e.grappledBy) ctx.fillStyle = '#add8e6';
            else if (e.isRamming) ctx.fillStyle = '#fff';
            else if (e.poisonTimer > 0) ctx.fillStyle = e.team === 1 ? '#f0e68c' : '#da70d6';
            else if (e.type === 'vampire' && !e.isBat) ctx.fillStyle = '#f0f0f0';
            else if (e.type === 'vampire' && e.isBat) ctx.fillStyle = '#222';
            else ctx.fillStyle = e.color;

            if (e.type === 'rogue' && e.isStealthed) ctx.globalAlpha = 0.2;
            if (e.realType === 'chameleon') { ctx.strokeStyle = 'lime'; ctx.lineWidth = 3; ctx.stroke(); }
            if (e.type === 'soldier' && e.state === 'reloading') ctx.fillStyle = '#888';
            if (e.type === 'devourer' && e.isDampening) ctx.fillStyle = '#440000';
            if (e.type === 'whispers' && e.isControlling) ctx.fillStyle = '#990099';

            ctx.fill();
            ctx.lineWidth = e.type === 'boid' ? 1 : 3;
            ctx.strokeStyle = isDark ? '#eee' : '#000';
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // Draw Spatial Effects
        if (e.type === 'spatial') { ctx.strokeStyle = 'cyan'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0,0, e.radius + 5, 0, Math.PI*2); ctx.stroke(); }
        if (e.isPortalTrapped) {
            ctx.save(); ctx.strokeStyle = 'cyan'; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.arc(0, 0, e.radius + 8, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-e.radius, 0); ctx.lineTo(e.radius, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -e.radius); ctx.lineTo(0, e.radius); ctx.stroke();
            ctx.restore();
        }

        // Draw Orbiter Orbs
        if (e.type === 'orbiter') { for(let i=0; i<e.orbCount; i++) { let a = e.orbAngle + (i * (Math.PI*2)/e.orbCount); let ox = Math.cos(a) * 35; let oy = Math.sin(a) * 35; ctx.fillStyle = 'cyan'; ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI*2); ctx.fill(); } }
        
        // Draw Eyes/Face
        if (e.type !== 'turret' && e.type !== 'boid') {
            if (e.type === 'necromancer') {
                // Dark Hood (Draws over the head)
                ctx.fillStyle = '#222'; 
                ctx.beginPath(); ctx.arc(0, 0, e.radius, Math.PI, 0); ctx.fill(); 
                
                // Skull Face mask
                ctx.fillStyle = '#eee';
                ctx.beginPath(); ctx.arc(0, 2, 10, 0, Math.PI*2); ctx.fill();
                
                // Green Glowing Eyes
                ctx.fillStyle = '#32cd32';
                ctx.beginPath(); ctx.arc(-4, 0, 2, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(4, 0, 2, 0, Math.PI*2); ctx.fill();
            }
                        // --- PASTE SKELETON HERE ---
            else if (e.type === 'skeleton') {
                // Ribcage lines
                ctx.fillStyle = '#333';
                ctx.fillRect(-6, -4, 12, 2);
                ctx.fillRect(-6, 0, 12, 2);
                ctx.fillRect(-6, 4, 12, 2);
                
                // Sword
                ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(25, 10); ctx.stroke();
            }

            // --- NEW: fight knight ARMOR HELMET ---
            else if (e.type === 'fight knight' && e.hasFeigned && e.resurrectionStage < 4) {
                // 1. Black Helmet Dome (Covers the face)
                ctx.fillStyle = '#111'; // Pitch black
                ctx.beginPath(); 
                ctx.arc(0, 0, e.radius, 0, Math.PI*2); 
                ctx.fill();

                // 2. Orange Glowing Visor (Matches the Armor particle color)
                ctx.fillStyle = e.color;
                ctx.shadowBlur = 10; 
                ctx.shadowColor = 'orange';
                
                // T-Visor Shape
                ctx.fillRect(8, -2, 10, 4);   // Horizontal Eye Slit
                ctx.fillRect(12, -7, 3, 14);  // Vertical Breathing Slit
                
                ctx.shadowBlur = 0; // Reset glow
            }

          

            if (e.isParanoid) { ctx.fillStyle='black';ctx.font='bold 20px Arial';ctx.textAlign='center';ctx.fillText('?',0,8); }
            else if (e.isDancing) { ctx.fillStyle='black';ctx.beginPath();ctx.arc(-5,-3,3,0,Math.PI,true);ctx.stroke();ctx.beginPath();ctx.arc(5,-3,3,0,Math.PI,true);ctx.stroke(); }
            else if (e.type === 'vampire' && !e.isBat) { ctx.fillStyle='red';ctx.beginPath();ctx.arc(8,-4,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(8,4,3,0,Math.PI*2);ctx.fill(); }
            else if (e.type === 'vampire' && e.isBat) { ctx.fillStyle='white';ctx.beginPath();ctx.arc(5,-3,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(5,3,2,0,Math.PI*2);ctx.fill(); }
              else if (e.isSleeping) {
                // SLEEPING FACE: Draw closed eyes (- -)
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                // Left Eye
                ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(14, -6); ctx.stroke();
                // Right Eye
                ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(14, 6); ctx.stroke();
            }

        else if (e.type === 'fight knight' && e.hasFeigned && e.resurrectionStage < 4) {
                // Do nothing (Eyes/Visor are drawn in the Body section)
            }
            else { 
                // STANDARD FACE (Existing code)
                ctx.fillStyle='white';
                ctx.beginPath();ctx.arc(10,-5,4,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(10,5,4,0,Math.PI*2);ctx.fill(); 
            }}

        ctx.rotate(-e.angle); // Un-rotate for Text
        if (e.type !== 'vampire' || !e.isBat) {
            if (e.type !== 'boid') {
                ctx.fillStyle = isDark ? '#fff' : '#000'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; 
                
                // --- NEW CONTEXT STATUS TEXT ---
                let statusText = Math.floor(e.hp);
                if (isNaN(e.hp)) statusText = "GLITCH"; // Fun context for errors
                else if (e.hp <= 0) statusText = "KO";  // Context for 0 HP
                else statusText = Math.max(0, statusText);

                ctx.fillText(statusText, 0, 5);
            }
        }

        if (GAME_MODE === 'clan' && (e.rageStacks > 0 || e.prideStacks > 0)) {
    ctx.save();
    ctx.font = "bold 12px Arial";
    
    if (e.rageStacks > 0) {
        ctx.fillStyle = "red";
        ctx.fillText(`RAGE x${e.rageStacks}`, 0, -35);
    }
    
    if (e.prideStacks > 0) {
        ctx.fillStyle = "gold";
        // If they have both, draw Pride slightly higher
        let yOffset = e.rageStacks > 0 ? -47 : -35;
        ctx.fillText(`PRIDE x${e.prideStacks}`, 0, yOffset);
    }
    ctx.restore();
}
        // --- CHARACTER NAME / NUMBER LABEL ---
if ((characterNamesEnabled || fighterNumbersEnabled) && e.type !== 'turret' && e.type !== 'boid' && !e.parentId) {
    const label = getFighterLabel(e);

    if (label) {
        ctx.save();

        // Important:
        // At this point the fighter body has already been un-rotated for HP text.
        // Do NOT rotate again, or the name tag will counter-spin.
        ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const textWidth = ctx.measureText(label).width;
        const boxWidth = textWidth + 12;
        const boxHeight = 16;
        const y = -e.radius - 22;

        ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
        ctx.strokeStyle = e.color || "#fff";
        ctx.lineWidth = 2;

        ctx.beginPath();

        if (ctx.roundRect) {
            ctx.roundRect(-boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, 6);
        } else {
            ctx.rect(-boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
        }

        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.fillText(label, 0, y);

        ctx.restore();
    }
}
        // --- PASTE HERE: ADVANCED MODE STATS ---
        // --- PASTE HERE: ADVANCED MODE STATS ---
        if (advancedMode && e.type !== 'turret' && e.type !== 'boid') {
            ctx.save();
            
            // Positioning: To the right of the unit
            let tx = 25; 
            let ty = -20;
            
            ctx.textAlign = "left";
            ctx.font = "10px monospace";
            
            // Background box for readability
            // NEW: Taller box if in Pet Mode to fit extra stats
            let boxHeight = GAME_MODE === 'pet' ? 55 : 45; 
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(tx - 2, ty - 10, 70, boxHeight); 
            
            ctx.fillStyle = "#0f0"; // Green text

            // Line 1: ID & Team
            let shortId = e.id.toFixed(3).slice(-3); 
            ctx.fillText(`ID:${shortId} T:${e.team}`, tx, ty);

            // Line 2: Bravery
            let brav = e.bravery ? e.bravery.toFixed(2) : "N/A";
            ctx.fillText(`Brav:${brav}`, tx, ty + 10);

            // Line 3: Class Specifics
            let extra = "";
            if (e.type === 'spatial') extra = `Str:${e.stress||0}`;
            else if (e.type === 'soldier') extra = `St:${e.state}`;
            else if (e.type === 'duplicator') extra = `Gen:${e.generation}`;
            else if (e.type === 'unarmed') extra = e.isBlocking ? "BLOCK" : (e.isRamming ? "RAM" : "");
            
            if (extra) ctx.fillText(extra, tx, ty + 20);
            
            // Line 4: Target Info
            if (e.target) {
                let tName = e.target.type.substring(0,3);
                ctx.fillText(`Tgt:${tName}`, tx, ty + 30);
            }

            // --- NEW: PET STATS (Line 5) ---
            if (GAME_MODE === 'pet') {
                let h = Math.floor(e.hunger || 0);
                let f = Math.floor(e.fun || 0);
                // Draw in yellow to stand out
                ctx.fillStyle = '#FFD700'; 
                ctx.fillText(`H:${h} F:${f}`, tx, ty + 40);
            }

            ctx.restore();
        }

         if (e.stuckArrows && e.stuckArrows.length > 0) {
    for (let i = e.stuckArrows.length - 1; i >= 0; i--) {
        let arrow = e.stuckArrows[i];
        arrow.life--;
        if (arrow.life <= 0) {
            e.stuckArrows.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.rotate(arrow.angle); // Rotate to where it hit relative to body
        
        // Draw sticking out from the edge of the radius
        // We move to the edge (radius) minus a bit (stickDepth) so it looks embedded
        let embedX = -(e.radius - 5 + arrow.stickDepth); 
        ctx.translate(embedX, 0); 
        
        // Fade out
        ctx.globalAlpha = Math.min(1.0, arrow.life / 30);
        
        // Shaft
        ctx.strokeStyle = 'brown';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-25, 0); // Stick out 25px
        ctx.stroke();

        // Fletching (Feathers)
        ctx.strokeStyle = arrow.type === 'flaming_arrow' ? 'orange' : 'white';
        ctx.beginPath();
        ctx.moveTo(-25, 0); ctx.lineTo(-32, -4);
        ctx.moveTo(-25, 0); ctx.lineTo(-32, 4);
        ctx.stroke();
        
        // Fire effect for flaming arrows
        if (arrow.type === 'flaming_arrow') {
            ctx.fillStyle = 'orange';
            ctx.beginPath(); ctx.arc(-25, 0, 3 + Math.random()*2, 0, Math.PI*2); ctx.fill();
        }

        ctx.restore();
    }
    // Reset alpha just in case
    ctx.globalAlpha = 1.0; 
}
// --- END NEW BLOCK ---




        ctx.restore();

       // Draw Wizard Zap Beam
if (e.type === 'wizard' && e.isZapping && e.target) {
    const wandTip = getFighterLocalPoint(e, 39, -16);

    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 3 + e.zapCharge;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 12;

    let nearby = entities.filter(ent => ent.team !== e.team);
    nearby.forEach(victim => {
        let dist = Math.sqrt((victim.x - e.x)**2 + (victim.y - e.y)**2);
        if (dist <= 250 && hasLineOfSight(wandTip, victim)) {
            ctx.beginPath();
            ctx.moveTo(wandTip.x, wandTip.y);

            let midX = (wandTip.x + victim.x) / 2 + (Math.random() - 0.5) * 20;
            let midY = (wandTip.y + victim.y) / 2 + (Math.random() - 0.5) * 20;

            ctx.lineTo(midX, midY);
            ctx.lineTo(victim.x, victim.y);
            ctx.stroke();

            // --- DRAW SPELL CLASH BUBBLE (WIZARD) ---
            if (e.clashTimer > 0 && e.target) {
                let progress = Math.min(1.0, e.clashTimer / 120);
                let midX = (e.x + e.target.x) / 2;
                let midY = (e.y + e.target.y) / 2;
                let jitter = (e.clashTimer / 10); 
                let drawX = midX + (Math.random() - 0.5) * jitter;
                let drawY = midY + (Math.random() - 0.5) * jitter;

                ctx.save();
                ctx.shadowBlur = 20 + jitter;
                ctx.shadowColor = 'cyan';

                let gradient = ctx.createRadialGradient(drawX, drawY, 5, drawX, drawY, 30 + progress * 20);
                gradient.addColorStop(0, 'white');
                gradient.addColorStop(0.5, frameCount % 4 < 2 ? '#00c3ff' : '#0077ff');
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(drawX, drawY, 30 + progress * 20, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    });

    ctx.shadowBlur = 0;
}

        // Draw Necromancer Blight Beam
        if (e.type === 'necromancer' && e.isBlighting && e.target) {
            // Wobbly Green Beam
            ctx.strokeStyle = '#32cd32'; 
            ctx.lineWidth = 4;
            ctx.beginPath(); 
            ctx.moveTo(e.x, e.y);
            
            // Calculate a jittery midpoint for "wither" effect
            let midX = (e.x + e.target.x)/2 + (Math.random()-0.5)*15;
            let midY = (e.y + e.target.y)/2 + (Math.random()-0.5)*15;
            
            ctx.lineTo(midX, midY); 
            ctx.lineTo(e.target.x, e.target.y); 
            ctx.stroke();
            
            // Particles at target
            if (frameCount % 4 === 0) spawnParticles(e.target.x, e.target.y, '#32cd32', 2);

            // --- DRAW SPELL CLASH VISUAL ---
            if (e.clashTimer > 0 && e.target) {
                let progress = Math.min(1.0, e.clashTimer / 120); // 0 to 1 based on timer
                
                // Calculate Midpoint
                let midX = (e.x + e.target.x) / 2;
                let midY = (e.y + e.target.y) / 2;
                
                // Jitter Effect increases as clash nears end
                let jitter = (e.clashTimer / 10); 
                let drawX = midX + (Math.random() - 0.5) * jitter;
                let drawY = midY + (Math.random() - 0.5) * jitter;

                // Draw Energy Ball
                ctx.save();
                ctx.shadowBlur = 20 + jitter;
                ctx.shadowColor = 'white';
                
                // Outer ring (Mix of Green and Cyan)
                let gradient = ctx.createRadialGradient(drawX, drawY, 5, drawX, drawY, 30 + progress * 20);
                gradient.addColorStop(0, 'white');
                gradient.addColorStop(0.5, frameCount % 4 < 2 ? 'cyan' : '#32cd32'); // Flicker colors
                gradient.addColorStop(1, 'transparent');
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(drawX, drawY, 30 + progress * 20, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        if (e.type === 'devourer' && e.isDampening) { ctx.strokeStyle = 'rgba(255,0,0,0.2)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(e.x, e.y, 800, 0, Math.PI*2); ctx.stroke(); }
        if (e.type === 'whispers' && e.isControlling) { ctx.strokeStyle = 'purple'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(e.x, e.y, 30, 0, Math.PI*2); ctx.stroke(); }
    });

    // --- 7. DRAW PROJECTILES ---
    projectiles.forEach(p => {
        if(p.dead) return;
        
        // 1. Draw Arrow / Flaming Arrow (POINTY VISUALS)
        if (p.type === 'arrow' || p.type === 'flaming_arrow') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx)); // Point in velocity direction
            
            // Shaft
            ctx.strokeStyle = 'brown'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
            
            // Pointy Head
            ctx.fillStyle = p.type === 'flaming_arrow' ? 'orange' : 'grey';
            ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(16, 0); ctx.lineTo(8, 3); ctx.fill();
            
            // Feathers
            ctx.strokeStyle = p.type === 'flaming_arrow' ? 'red' : 'white'; ctx.lineWidth = 1;
            ctx.beginPath(); 
            ctx.moveTo(-10, 0); ctx.lineTo(-16, -4);
            ctx.moveTo(-10, 0); ctx.lineTo(-16, 4);
            ctx.stroke();

            // Fire Effect
            if (p.type === 'flaming_arrow') {
                ctx.fillStyle = 'rgba(255, 100, 0, 0.6)';
                ctx.beginPath(); ctx.arc(10, 0, 5 + Math.random() * 3, 0, Math.PI*2); ctx.fill();
                spawnParticles(p.x, p.y, 'orange', 1);
            }
            
            ctx.restore();
            return; // Stop here so we don't draw the default circle
        }

        // 2. Draw Mine
        if (p.isMine) {
            let r = 10;
            ctx.fillStyle = 'black'; ctx.fillRect(p.x - r, p.y - r, r*2, r*2);
            ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(p.x, p.y, r/2, 0, Math.PI*2); ctx.fill();
            return;
        }

        // 3. Draw Hook (UPDATED: High Visibility Cable)
        if (p.type === 'hook') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx));

            // --- CABLE TRAIL (Two-Tone for visibility) ---
            
            // Layer 1: Thick Black Background (Outline)
            // This ensures it is visible on both light and dark maps
            ctx.beginPath();
            ctx.moveTo(-5, 0);
            ctx.lineTo(-30, 0); // Extended length
            ctx.strokeStyle = '#000000'; 
            ctx.lineWidth = 7; 
            ctx.lineCap = 'round';
            ctx.stroke();

            // Layer 2: Grey Metallic Core
            ctx.beginPath();
            ctx.moveTo(-5, 0);
            ctx.lineTo(0, 0);
            ctx.strokeStyle = '#999999'; 
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();

            // --- HOOK HEAD ---
            ctx.fillStyle = '#b0c4de'; // Light Steel Blue
            ctx.strokeStyle = '#000'; 
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(-8, -4);
            ctx.lineTo(2, -4);
            ctx.bezierCurveTo(14, -4, 14, 10, 2, 10); // Wider hook curve
            ctx.lineTo(0, 7);
            ctx.bezierCurveTo(8, 7, 8, 0, 2, 0);
            ctx.lineTo(-8, 0);
            ctx.closePath();

            ctx.fill();
            ctx.stroke();
            
            ctx.restore();
            return;
        }

       // 4. Default Projectiles (Orbs, Bullets, Fireballs)
if (
    projectileTrailsEnabled &&
    (p.type === 'bullet' || p.type === 'cannonball') &&
    p.trail &&
    p.trail.length > 0
) {
    ctx.save();
    ctx.lineCap = 'round';

    const points = [{ x: p.x, y: p.y }, ...p.trail];

    for (let i = 0; i < points.length - 1; i++) {
        const alpha = 1 - i / points.length;

        if (p.type === 'cannonball') {
            ctx.strokeStyle = `rgba(255, 120, 20, ${0.45 * alpha})`;
            ctx.lineWidth = 7 * alpha + 1;
        } else {
            const darkMode = document.body.classList.contains('dark-mode');
            ctx.strokeStyle = darkMode
                ? `rgba(230, 230, 230, ${0.35 * alpha})`
                : `rgba(30, 30, 30, ${0.28 * alpha})`;
            ctx.lineWidth = 3 * alpha + 0.5;
        }

        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
        ctx.stroke();
    }

    ctx.restore();
}

ctx.beginPath(); 
        let r = 5; let col = p.type==='orb'?'cyan': (p.type==='fireball' || p.type==='cannonball'?'orange' : (document.body.classList.contains('dark-mode')?'#fff':'black'));
        if (p.type === 'orb') r = 9; if (p.type === 'fireball' || p.type==='cannonball') r = 14; if (p.type === 'bullet') r = 4; 
        if (p.type === 'potion') col = p.pType;
        if (p.type === 'flashbang') {
    ctx.fillStyle = '#858886'; 
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath(); 
    ctx.rect(p.x - 4, p.y - 6, 8, 12); // Draw a canister shape
    ctx.fill(); 
    ctx.stroke();
    return;
}

        if (p.type === 'spear') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy || 0, p.vx || 0));

            const kind = p.spearKind || 'normal';
            ctx.strokeStyle = kind === 'explosive' ? '#e17055' : (kind === 'bounce' ? '#74b9ff' : '#8d6e63');
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-18, 0);
            ctx.lineTo(18, 0);
            ctx.stroke();

            ctx.fillStyle = kind === 'explosive' ? '#ff7675' : '#dfe6e9';
            ctx.strokeStyle = '#2d3436';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(18, -6);
            ctx.lineTo(34, 0);
            ctx.lineTo(18, 6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (kind === 'explosive') {
                ctx.fillStyle = '#fdcb6e';
                ctx.beginPath();
                ctx.arc(-10, 0, 5 + Math.sin(frameCount * 0.4) * 1, 0, Math.PI * 2);
                ctx.fill();
            }

            if (kind === 'bounce') {
                ctx.strokeStyle = '#00cec9';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 12, -0.6, 0.6);
                ctx.stroke();
            }

            ctx.restore();
            return;
        }

        if (p.type === 'fish') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx));
            ctx.fillStyle = '#00cec9';
            ctx.strokeStyle = '#006f7a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#81ecec';
            ctx.beginPath();
            ctx.moveTo(-9, 0);
            ctx.lineTo(-17, -6);
            ctx.lineTo(-17, 6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            return;
        }

        if (p.type === 'water') {
            ctx.save();
            ctx.globalAlpha = 0.82;
            ctx.fillStyle = '#81ecec';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#00cec9';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            return;
        }

        ctx.arc(p.x, p.y, r, 0, Math.PI*2); 
        ctx.fillStyle = col; 
        ctx.fill();
    });
// --- MUZZLE FLASHES ---
drawMuzzleFlashes();
    // --- 8. PARTICLES ---
    particles.forEach(p => { 
            ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color; 
            
            if(p.type === 'note') { 
                ctx.font = '12px Arial'; ctx.fillText('♪', p.x, p.y); 
            } 
            else if (p.type === 'hemisphere') {
                // Draw "Cut in Half" corpse part
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.beginPath();
                // Draw a semi-circle
                ctx.arc(0, 0, p.radius, -Math.PI/2, Math.PI/2);
                ctx.fill();
                ctx.restore();
            }
            else { 
                ctx.fillRect(p.x, p.y, 6, 6); 
            }
        });
    ctx.globalAlpha = 1;

    // --- 9. DAMAGE TEXT ---
    damageText.forEach(t => {
        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.translate(t.x, t.y);
        ctx.font = t.isCrit ? "bold 24px Impact" : "bold 16px Arial";
        ctx.fillStyle = t.color;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = t.isCrit ? 3 : 2;
        ctx.textAlign = "center";
        ctx.strokeText(t.text, 0, 0);
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
    });

    // --- DRAW PICKUPS ---
    pickups.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        
        // Glow effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'gold';

        // PET MODE FOOD VISUALS
        if (p.type === 'apple') {
            ctx.fillStyle = '#ff4757'; // Red Body
            ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#2ecc71'; // Green Leaf
            ctx.beginPath(); ctx.ellipse(0, -8, 4, 2, Math.PI/4, 0, Math.PI*2); ctx.fill();
            ctx.restore(); return;
        }
        if (p.type === 'meat') {
            ctx.fillStyle = '#A0522D'; // Brown
            ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#eee'; // Bone ends
            ctx.beginPath(); ctx.arc(-10, 0, 4, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI*2); ctx.fill();
            ctx.restore(); return;
        }
        if (p.type === 'candy') {
            ctx.fillStyle = '#a29bfe'; 
            ctx.fillRect(-8, -4, 16, 8);
            ctx.fillStyle = '#fd79a8'; 
            ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
            ctx.restore(); return;
        }


        if (p.type === 'dagger') {
            ctx.fillStyle = '#ccc'; ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(5, 5); ctx.lineTo(0, 15); ctx.lineTo(-5, 5); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#8B4513'; ctx.fillRect(-2, 10, 4, 8); // Handle
        } 
        else if (p.type === 'gun') {
            ctx.fillStyle = '#333';
            ctx.fillRect(-8, -5, 16, 8); // Barrel
            ctx.fillStyle = '#555';
            ctx.fillRect(-8, 0, 6, 10); // Handle
        } 
        else if (p.type === 'scythe') {
            ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -15); ctx.stroke(); // Handle
            ctx.strokeStyle = '#ccc'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, -15, 12, 0, Math.PI, true); ctx.stroke(); // Blade
        }
        
        ctx.restore();
    });
    

    ctx.restore(); // Restore Camera Transform
}
        

        // Initialize immediately
        window.addEventListener('DOMContentLoaded', () => {
        
            updateSquadUI(); // Populate selectors, which calls initializeSquads()
        });

        // --- TOGGLE CONTROLS LOGIC ---
let controlsVisible = true;

function toggleControls() {
    const controls = document.getElementById('controlsPanel'); // We added this ID in step 1
    const btn = document.getElementById('toggleControlsBtn');
    
    // Toggle State
    controlsVisible = !controlsVisible;

    if (controlsVisible) {
        // Show
        controls.style.display = 'flex'; 
        btn.innerHTML = 'Hide Controls &#9650;'; // Up Arrow
        btn.style.backgroundColor = '#555';
    } else {
        // Hide
        controls.style.display = 'none';
        btn.innerHTML = 'Show Controls &#9660;'; // Down Arrow
        btn.style.backgroundColor = '#2d3436'; // Darker when closed
    }
}

// --- LEADERBOARD LOGIC (LOCAL STORAGE) ---
const LB_KEY = 'ballBattle_leaderboard_v1';

function saveHighscore(name, kills) {
    // 1. Get existing data
    let scores = JSON.parse(localStorage.getItem(LB_KEY)) || [];

    // 2. Add new score with date
    let date = new Date().toLocaleDateString();
    scores.push({ name: name, kills: kills, date: date });

    // 3. Sort by Kills (Highest first)
    scores.sort((a, b) => b.kills - a.kills);

    // 4. Keep only Top 50 to save space
    if (scores.length > 50) scores = scores.slice(0, 50);

    // 5. Save back to local storage
    localStorage.setItem(LB_KEY, JSON.stringify(scores));
}

function openLeaderboard() {
    const modal = document.getElementById('leaderboardModal');
    const tbody = document.getElementById('leaderboardBody');
    const scores = JSON.parse(localStorage.getItem(LB_KEY)) || [];
    
    tbody.innerHTML = ''; // Clear current list

    if (scores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:10px;">No battles recorded yet!</td></tr>';
    } else {
        scores.forEach((s, index) => {
            let rowColor = 'inherit';
            if(index === 0) rowColor = 'gold';       // 1st Place
            if(index === 1) rowColor = 'silver';     // 2nd Place
            if(index === 2) rowColor = '#cd7f32';    // 3rd Place

            let row = `
                <tr style="border-bottom:1px solid #444; color:${rowColor}; font-weight:${index < 3 ? 'bold' : 'normal'}">
                    <td style="padding:8px;">#${index + 1}</td>
                    <td style="padding:8px;">${s.name}</td>
                    <td style="padding:8px;">${s.kills} ☠</td>
                    <td style="padding:8px; font-size:0.8rem; opacity:0.7;">${s.date}</td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    }
    
    modal.style.display = 'block';
}

function closeLeaderboard() {
    document.getElementById('leaderboardModal').style.display = 'none';
}

function clearLeaderboard() {
    if(confirm("Are you sure you want to delete all score history?")) {
        localStorage.removeItem(LB_KEY);
        openLeaderboard(); // Refresh view
    }
}
// --- FIGHTER EDITOR LOGIC ---

function openEditor() {
    document.getElementById('editorModal').style.display = 'block';
}

function closeEditor() {
    document.getElementById('editorModal').style.display = 'none';
}

function applyEditor() {
    const target = document.getElementById('editorTarget').value;
    const hpMult = parseFloat(document.getElementById('editHp').value) || 1.0;
    const dmgMult = parseFloat(document.getElementById('editDmg').value) || 1.0;

    let count = 0;

    entities.forEach(e => {
        // Filter logic
        let match = false;
        if (target === 'all') match = true;
        if (target === 'p1' && e.team === 1) match = true;
        if (target === 'p2' && e.team === 2) match = true;
        
        // Exclude environment objects
        if (e.type === 'turret' || e.type === 'boid') match = false;

        if (match) {
            // Update Stats
            e.maxHp = e.maxHp * hpMult; // Scale Max HP
            e.hp = e.maxHp;             // Heal to full
            e.dmgMult = dmgMult;        // Set Damage
            
            // Visual feedback
            spawnParticles(e.x, e.y, 'gold', 10);
            count++;
        }
    });

    showCustomMessage("Stats Updated", `Applied to ${count} fighters!`);
    closeEditor();
}

function randomizeStats(group) {
    let count = 0;
    
    entities.forEach(e => {
        // Filter logic
        let match = false;
        if (group === 'all') match = true;
        if (group === 'p1' && e.team === 1) match = true;
        if (group === 'p2' && e.team === 2) match = true;
        
        // Exclude environment
        if (e.type === 'turret' || e.type === 'boid') match = false;

        if (match) {
            // Generate Random Multipliers (0.5x to 3.0x)
            let rndHp = 0.5 + Math.random() * 2.5;
            let rndDmg = 0.5 + Math.random() * 2.5;

            // Apply
            e.maxHp = 100 * rndHp; // Reset to base 100 then scale, or scale current? Let's scale current base.
            // Safer way: Reset to original data hp then scale
            if (FIGHTER_DATA[e.realType]) {
                e.maxHp = FIGHTER_DATA[e.realType].hp * rndHp;
            } else {
                e.maxHp = 100 * rndHp;
            }
            e.hp = e.maxHp;
            e.dmgMult = rndDmg;

            // Visuals
            spawnParticles(e.x, e.y, 'purple', 5);
            spawnDamageText(e.x, e.y - 30, `HP x${rndHp.toFixed(1)}`, '#fff');
            count++;
        }
    });
    
    showCustomMessage("Chaos Mode", `Randomized ${count} fighters!`);
    closeEditor();
}
// --- IMPROVED EDITOR LOGIC ---

function openEditor() {
    const select = document.getElementById('editorTarget');
    select.innerHTML = '';

    // 1. Add Group Options
    let groups = [
        {val: 'all', text: '⚡ Everyone'},
        {val: 'p1', text: '🔵 Left Team (All)'},
        {val: 'p2', text: '🔴 Right Team (All)'}
    ];

    groups.forEach(g => {
        let opt = document.createElement('option');
        opt.value = g.val;
        opt.innerText = g.text;
        select.appendChild(opt);
    });

    // 2. Add Separator
    let sep = document.createElement('option');
    sep.disabled = true;
    sep.innerText = '--- Individuals ---';
    select.appendChild(sep);

    // 3. Add Individual Fighters
    // Filter out turrets/mines/etc, sort by ID to keep list stable
    let fighters = entities.filter(e => e.type !== 'turret' && e.type !== 'boid' && e.spawnSide).sort((a,b) => a.id - b.id);
    
    fighters.forEach(e => {
        let opt = document.createElement('option');
        // We use the ID to find them now, but we need spawnIndex for saving
        opt.value = e.id; 
        let name = getEntityName(e);
        let side = e.team === 1 ? '(L)' : '(R)';
        opt.innerText = `${side} ${name}`;
        select.appendChild(opt);
    });

    document.getElementById('editorModal').style.display = 'block';
}

function closeEditor() {
    document.getElementById('editorModal').style.display = 'none';
}

// Helper to save stats to memory so they survive RESET
function saveOverride(ent, hp, dmg, brav) {
    if (ent.spawnSide && ent.spawnIndex !== null) {
        const key = `${ent.spawnSide}_${ent.spawnIndex}`;
        fighterOverrides[key] = { hpMult: hp, dmgMult: dmg, bravery: brav };
    }
}

function resetSelectedTarget() {
    // Just apply 1.0 multipliers
    document.getElementById('editHp').value = "1.0";
    document.getElementById('editDmg').value = "1.0";
    applyEditor();
    
    // Also remove from memory to keep it clean
    const targetVal = document.getElementById('editorTarget').value;
    if (targetVal === 'all') fighterOverrides = {}; // Clear all
    else if (targetVal === 'p1' || targetVal === 'p2') {
        // Clear specific side keys
        for (let key in fighterOverrides) {
            if (key.startsWith(targetVal)) delete fighterOverrides[key];
        }
    } else {
        // Clear individual
        let ent = entities.find(e => e.id == targetVal);
        if (ent && ent.spawnSide) {
             const key = `${ent.spawnSide}_${ent.spawnIndex}`;
             delete fighterOverrides[key];
        }
    }
    showCustomMessage("Reset", "Stats reset to normal.");
}

function randomizeSelectedTarget() {
    // Generate random values and fill the inputs, then apply
    let rndHp = (0.5 + Math.random() * 2.5).toFixed(1);
    let rndDmg = (0.5 + Math.random() * 2.5).toFixed(1);
    
    document.getElementById('editHp').value = rndHp;
    document.getElementById('editDmg').value = rndDmg;
    
    // If target is a group, we want CHAOS (everyone gets different random stats)
    // If target is individual, they get these specific random stats
    const targetVal = document.getElementById('editorTarget').value;
    
    if (['all', 'p1', 'p2'].includes(targetVal)) {
        applyChaos(targetVal); // Special function for group chaos
    } else {
        applyEditor(); // Standard apply for individual
    }
}

function applyChaos(group) {
    let count = 0;
    entities.forEach(e => {
        let match = false;
        if (group === 'all') match = true;
        else if (group === 'p1' && e.team === 1) match = true;
        else if (group === 'p2' && e.team === 2) match = true;
        
        if (match && e.spawnSide) {
            // Generate unique randoms for EACH fighter
            let h = 0.5 + Math.random() * 2.5;
            let d = 0.5 + Math.random() * 2.5;
            
            // Apply Live
            // Reset to base HP from Data to avoid exponential growth if clicked multiple times
            let base = FIGHTER_DATA[e.realType] ? FIGHTER_DATA[e.realType].hp : 100;
            e.maxHp = base * h;
            e.hp = e.maxHp;
            e.dmgMult = d;
            
            // Save Memory
            saveOverride(e, h, d);
            
            spawnParticles(e.x, e.y, 'purple', 5);
            count++;
        }
    });
    showCustomMessage("Chaos Mode", `Randomized ${count} fighters!`);
    closeEditor();
}

function applyEditor() {
    const targetVal = document.getElementById('editorTarget').value;
    const hpMult = parseFloat(document.getElementById('editHp').value) || 1.0;
    const dmgMult = parseFloat(document.getElementById('editDmg').value) || 1.0;
    const bravVal = parseFloat(document.getElementById('editBrav').value);
    
    let count = 0;

    entities.forEach(e => {
        let match = false;

        // 1. Check Group Match
        if (targetVal === 'all') match = true;
        else if (targetVal === 'p1' && e.team === 1) match = true;
        else if (targetVal === 'p2' && e.team === 2) match = true;
        // 2. Check Individual Match (ID comparison)
        else if (e.id == targetVal) match = true;

        // Skip non-fighters
        if (e.type === 'turret' || e.type === 'boid') match = false;

        if (match) {
            // Apply Live Logic
            let base = FIGHTER_DATA[e.realType] ? FIGHTER_DATA[e.realType].hp : 100;
            e.maxHp = base * hpMult;
            e.hp = e.maxHp;
            e.dmgMult = dmgMult;
            e.bravery = bravVal; // Add this
            
            saveOverride(e, hpMult, dmgMult, bravVal);

            spawnParticles(e.x, e.y, 'gold', 10);
            count++;
        }
    });

    showCustomMessage("Stats Updated", `Applied to ${count} fighter(s).`);
    closeEditor();
}
function showRow(rowNum) {
    document.querySelectorAll('.control-row').forEach(row => {
        row.style.display = 'none';
        row.classList.remove('active-control-row');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active-tab'));

    const targetRow = document.getElementById('row-' + rowNum);
    if (targetRow) {
        targetRow.style.display = 'flex';
        targetRow.classList.add('active-control-row');
    }

    const tabBtn = document.getElementById('btn-tab-' + rowNum);
    if (tabBtn) tabBtn.classList.add('active-tab');

    if (typeof updateFullscreenHud === 'function') updateFullscreenHud();
}
function spawnCorpseParts(victim, slashAngle) {
    // Helper to create a drifting body part
    function addHalf(angleOffset, moveDir) {
        particles.push({
            x: victim.x, 
            y: victim.y,
            // Drift apart perpendicular to the slash
            vx: Math.cos(slashAngle + moveDir) * 1.5, 
            vy: Math.sin(slashAngle + moveDir) * 1.5,
            life: 180,      // Lasts 3 seconds
            alpha: 1, 
            color: victim.color,
            type: 'hemisphere', 
            radius: victim.radius, 
            angle: slashAngle + angleOffset // Rotate the graphic to match the cut
        });
    }

    // Top Half (Left of cut)
    addHalf(0, -Math.PI/2);
    
    // Bottom Half (Right of cut) - Rotated 180 (PI) to face the other way
    addHalf(Math.PI, Math.PI/2);
}
function shootDualdualist(e) {
    // 1. Shoot Primary Target (Left Gun)
    shootBullet(e);

    // 2. Find Secondary Target
    // Filter for enemies that are NOT the current main target
    let enemies = entities.filter(ent => ent.team !== e.team && !ent.isStealthed && ent.hp > 0 && ent.id !== e.target?.id);
    
    // Find closest secondary
    let secondTarget = null;
    let minD = 9999;
    enemies.forEach(en => {
        let d = Math.sqrt((en.x - e.x)**2 + (en.y - e.y)**2);
        if (d < minD) { minD = d; secondTarget = en; }
    });

    if (secondTarget) {
        // CASE A: Two enemies exist. Split fire.
        playSound('shot');
        recordShot(e);
        let angle2 = Math.atan2(secondTarget.y - e.y, secondTarget.x - e.x);
spawnMuzzleFlash(e, angle2, 'bullet');

let spawnX = e.x + Math.cos(angle2) * (e.radius + 5);
let spawnY = e.y + Math.sin(angle2) * (e.radius + 5);

        projectiles.push({
            x: spawnX, y: spawnY,
            vx: Math.cos(angle2) * 15,
            vy: Math.sin(angle2) * 15,
            team: e.team, life: 60, type: 'bullet',
            shooterId: e.id 
        });
    } else {
        // CASE B: Only one enemy. Double Tap! (Right Gun)
        // Fire a second bullet at the main target with slight spread so they don't overlap perfectly
        recordShot(e);
        let spread = 0.05; // Slight angle offset
        let angle = e.angle + spread;
spawnMuzzleFlash(e, angle, 'bullet');
        
projectiles.push({
            x: e.x + Math.cos(angle) * (e.radius + 5), 
            y: e.y + Math.sin(angle) * (e.radius + 5),
            vx: Math.cos(angle) * 15,
            vy: Math.sin(angle) * 15,
            team: e.team, life: 60, type: 'bullet',
            shooterId: e.id 
        });
    }
}
function shootFlashbang(e) {
    const target = e.target || pickEffectiveFlashbangTarget(e);
    if (!target) return false;

    const dist = Math.sqrt((target.x - e.x)**2 + (target.y - e.y)**2);
    if (dist > 430 || !hasLineOfSight(e, target)) return false;

    const speed = 12;
    const travelTime = Math.max(12, dist / speed);
    const predX = target.x + (target.vx || 0) * travelTime;
    const predY = target.y + (target.vy || 0) * travelTime;
    const angle = Math.atan2(predY - e.y, predX - e.x);

    projectiles.push({
        x: e.x + Math.cos(angle) * (e.radius + 8),
        y: e.y + Math.sin(angle) * (e.radius + 8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        team: e.team,
        life: travelTime,
        type: 'flashbang',
        shooterId: e.id,
        targetX: predX,
        targetY: predY
    });

    playSound('shot', 0.65);
    return true;
}

function explodeFlashbang(p) {
    playSound('explosion_small', 0.55);
    spawnParticles(p.x, p.y, 'white', 50);

    let effectiveHits = 0;

    entities.forEach(en => {
        if (en.team === p.team || en.hp <= 0) return;

        const d = Math.sqrt((en.x - p.x)**2 + (en.y - p.y)**2);

        if (d < 155) {
            const power = 1 - d / 155;
            en.frozen = Math.max(en.frozen || 0, Math.round(90 + 80 * power));
            en.vx *= 0.08;
            en.vy *= 0.08;
            en.angle += Math.PI + (Math.random() - 0.5);
            en.flashTime = 8;
            en.lastAttackerId = p.shooterId;
            effectiveHits++;

            spawnDamageText(en.x, en.y - 30, "FLASHED!", "#ffffff", true);
            spawnParticles(en.x, en.y, '#fff', 5);
        }
    });

    if (effectiveHits === 0) {
        spawnDamageText(p.x, p.y - 20, "MISS", "#b2bec3");
    }

    p.dead = true;
}


/* --- STABLE PATCH: compact UI support + working Aquamarine/Mammoth ---
   This patch intentionally wraps the existing AI instead of rewriting the whole game loop.
   It fixes the new fighters even if older logic above did not call their handlers. */

function safeHasLineOfSight(a, b) {
    try {
        return typeof hasLineOfSight === 'function' ? hasLineOfSight(a, b) : true;
    } catch (err) {
        return true;
    }
}

function getVisibleEnemyCandidatesFor(unit) {
    return entities.filter(ent =>
        ent &&
        ent.hp > 0 &&
        ent.id !== unit.id &&
        ent.team !== unit.team &&
        ent.type !== 'turret' &&
        ent.type !== 'boid' &&
        ent.type !== 'mammoth_mount' &&
        !ent.isStealthed &&
        !ent.isFeigning
    );
}

function findBestAquamarineTarget(e) {
    const enemies = getVisibleEnemyCandidatesFor(e);
    let best = null;
    let bestScore = -Infinity;

    enemies.forEach(enemy => {
        const d = getDistance(e, enemy);
        const los = safeHasLineOfSight(e, enemy) ? 1 : 0;
        const cluster = enemies.filter(other => other !== enemy && getDistance(enemy, other) < 130).length;
        const injuredBonus = enemy.hp < enemy.maxHp * 0.45 ? 70 : 0;
        const score = los * 120 + cluster * 40 + injuredBonus - d * 0.22;

        if (score > bestScore) {
            bestScore = score;
            best = enemy;
        }
    });

    return best;
}

function spawnAquamarineFish(e, target) {
    if (!e || !target) return false;

    const baseAngle = Math.atan2(target.y - e.y, target.x - e.x);
    const count = 3;

    for (let i = 0; i < count; i++) {
        const spread = (i - 1) * 0.24;
        const angle = baseAngle + spread;
        const side = (i - 1) * 9;

        projectiles.push({
            x: e.x + Math.cos(angle) * (e.radius + 10) - Math.sin(baseAngle) * side,
            y: e.y + Math.sin(angle) * (e.radius + 10) + Math.cos(baseAngle) * side,
            vx: Math.cos(angle) * 7.5,
            vy: Math.sin(angle) * 7.5,
            team: e.team,
            life: 240,
            type: 'fish',
            targetId: target.id,
            shooterId: e.id,
            radius: 8,
            biteTimer: 0,
            turnRate: 0.14 + Math.random() * 0.04
        });
    }

    e.fishBurstTimer = 18;
    spawnParticles(e.x, e.y, '#00cec9', 10);
    spawnDamageText(e.x, e.y - 32, 'FISH SWARM', '#00cec9', true);
    if (typeof playSound === 'function') playSound('zap', 0.35);
    return true;
}

function sprayAquamarineWater(e, target) {
    if (!e || !target) return false;

    const baseAngle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = baseAngle;
    e.waterSprayTimer = 12;

    for (let i = -2; i <= 2; i++) {
        const angle = baseAngle + i * 0.08 + (Math.random() - 0.5) * 0.04;
        const speed = 15.5 + Math.random() * 2.8;

        projectiles.push({
            x: e.x + Math.cos(angle) * (e.radius + 15),
            y: e.y + Math.sin(angle) * (e.radius + 15),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            team: e.team,
            life: 26,
            type: 'water',
            shooterId: e.id,
            radius: 9 + Math.random() * 3,
            pushPower: 0.75
        });
    }

    spawnParticles(
        e.x + Math.cos(baseAngle) * 20,
        e.y + Math.sin(baseAngle) * 20,
        '#81ecec',
        6
    );
    return true;
}

function updateAquamarine(e) {
    if (!e || e.type !== 'aquamarine' || e.hp <= 0 || e.isDancing) return;

    if (e.fishCooldown === undefined) e.fishCooldown = 30;
    if (e.waterCooldown === undefined) e.waterCooldown = 10;
    if (e.fishBurstTimer === undefined) e.fishBurstTimer = 0;
    if (e.waterSprayTimer === undefined) e.waterSprayTimer = 0;

    if (e.fishCooldown > 0) e.fishCooldown--;
    if (e.waterCooldown > 0) e.waterCooldown--;
    if (e.fishBurstTimer > 0) e.fishBurstTimer--;
    if (e.waterSprayTimer > 0) e.waterSprayTimer--;

    const target = (e.target && e.target.hp > 0) ? e.target : findBestAquamarineTarget(e);
    if (!target) return;

    e.target = target;

    const d = getDistance(e, target);

    if (e.fishCooldown <= 0 && d < 620) {
        spawnAquamarineFish(e, target);
        e.fishCooldown = 105;
    }

    if (e.waterCooldown <= 0 && d < 330 && safeHasLineOfSight(e, target)) {
        sprayAquamarineWater(e, target);
        e.waterCooldown = 10;
    }
}

function handleAquamarineAI(e) {
    if (!e || e.type !== 'aquamarine') return false;

    const target = findBestAquamarineTarget(e);
    if (!target) return true;

    e.target = target;
    const d = getDistance(e, target);
    const angle = Math.atan2(target.y - e.y, target.x - e.x);

    e.angle = angle;

    // Aquamarine fights like a ranged controller: keeps distance, strafes, and sprays.
    let moveAngle;
    if (d < 170) {
        moveAngle = angle + Math.PI;
    } else if (d > 390) {
        moveAngle = angle;
    } else {
        const side = ((Math.floor(frameCount / 55) + Math.floor(e.id * 1000)) % 2 === 0) ? 1 : -1;
        moveAngle = angle + Math.PI / 2 * side;
    }

    e.vx += Math.cos(moveAngle) * 0.42;
    e.vy += Math.sin(moveAngle) * 0.42;

    // Avoid edges so fish/water have room to work.
    const edge = 58;
    if (e.x < edge) e.vx += 0.7;
    if (e.x > canvas.width - edge) e.vx -= 0.7;
    if (e.y < edge) e.vy += 0.7;
    if (e.y > canvas.height - edge) e.vy -= 0.7;

    updateAquamarine(e);
    return true;
}

function handleMammothMountAI(e) {
    if (!e || e.type !== 'mammoth_mount') return false;

    const owner = entities.find(ent => ent.id === e.ownerId && ent.hp > 0);
    if (!owner) {
        e.hp = 0;
        spawnParticles(e.x, e.y, '#8d6e63', 12);
        return true;
    }

    const target = owner.target && owner.target.hp > 0 ? owner.target : findClosestEnemyFor(owner);
    e.target = target || null;

    if (target) {
        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.angle = angle;
        e.vx += Math.cos(angle) * 0.55;
        e.vy += Math.sin(angle) * 0.55;
    } else {
        const d = getDistance(e, owner);
        if (d > 25) {
            const angle = Math.atan2(owner.y - e.y, owner.x - e.x);
            e.vx += Math.cos(angle) * 0.25;
            e.vy += Math.sin(angle) * 0.25;
        }
    }

    const maxSpeed = 6.2;
    const speed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (speed > maxSpeed) {
        e.vx = e.vx / speed * maxSpeed;
        e.vy = e.vy / speed * maxSpeed;
    }

    return true;
}

function ensureMammothMount(rider) {
    if (!rider || rider.type !== 'mammoth') return null;

    let mount = rider.mammothId
        ? entities.find(ent => ent.id === rider.mammothId && ent.hp > 0 && ent.type === 'mammoth_mount')
        : null;

    if (!mount && !isSetupPhase && rider.hp > 0) {
        mount = createFighter('mammoth_mount', rider.x, rider.y + 18, rider.team, false, rider.id, null, rider.spawnSide, rider.spawnIndex);
        mount.ownerId = rider.id;
        mount.color = '#6d4c41';
        mount.originalType = 'mammoth_mount';
        mount.realType = 'mammoth_mount';
        mount.radius = 38;
        mount.mass = 6.2;
        mount.hp = Math.max(mount.hp || 0, 220 * (GLOBAL_HP_MULT || 1));
        mount.maxHp = mount.hp;
        mount.bravery = 1;
        mount.angle = rider.angle || 0;
        entities.push(mount);

        rider.mammothId = mount.id;
        rider.isMounted = true;
        spawnParticles(rider.x, rider.y, '#8d6e63', 24);
        spawnDamageText(rider.x, rider.y - 38, 'MAMMOTH!', '#8d6e63', true);
        if (typeof playSound === 'function') playSound('heavy_hit', 0.45);
    }

    return mount || null;
}

function updateMammothRider(e) {
    if (!e || e.type !== 'mammoth' || e.hp <= 0) return;

    const mount = ensureMammothMount(e);
    if (!mount || mount.hp <= 0) return;

    if (e.mammothStompCooldown === undefined) e.mammothStompCooldown = 0;
    if (e.mammothStompCooldown > 0) e.mammothStompCooldown--;

    const enemies = getVisibleEnemyCandidatesFor(e);
    enemies.forEach(enemy => {
        const d = getDistance(mount, enemy);
        if (d < mount.radius + enemy.radius + 20) {
            const angle = Math.atan2(enemy.y - mount.y, enemy.x - mount.x);

            if (e.mammothStompCooldown <= 0) {
                damageEntity(enemy, 9.0, enemy.x, enemy.y, e);
                enemy.vx += Math.cos(angle) * 9.5;
                enemy.vy += Math.sin(angle) * 9.5;
                spawnParticles(enemy.x, enemy.y, '#8d6e63', 14);
                spawnDamageText(enemy.x, enemy.y - 34, 'TRAMPLE', '#8d6e63', true);
                e.mammothStompCooldown = 22;
                if (typeof playSound === 'function') playSound('heavy_hit', 0.45);
            } else {
                enemy.vx += Math.cos(angle) * 0.9;
                enemy.vy += Math.sin(angle) * 0.9;
            }
        }
    });
}

function handleMammothRiderAI(e) {
    if (!e || e.type !== 'mammoth') return false;

    const target = findClosestEnemyFor(e);
    if (target) {
        e.target = target;
    }

    const mount = ensureMammothMount(e);
    if (mount && mount.hp > 0) {
        if (target) {
            mount.target = target;
            const angle = Math.atan2(target.y - mount.y, target.x - mount.x);
            mount.angle = angle;
            mount.vx += Math.cos(angle) * 0.38;
            mount.vy += Math.sin(angle) * 0.38;
        }

        // Rider sits visibly above the mammoth instead of moving like a normal ball.
        e.x = mount.x;
        e.y = mount.y - mount.radius * 0.42;
        e.vx = mount.vx * 0.35;
        e.vy = mount.vy * 0.35;
        e.angle = mount.angle;

        updateMammothRider(e);
        return true;
    }

    return true;
}

function killOwnedMammothMount(ownerId) {
    entities.forEach(ent => {
        if (ent && ent.type === 'mammoth_mount' && ent.ownerId === ownerId && ent.hp > 0) {
            ent.hp = 0;
            spawnParticles(ent.x, ent.y, '#8d6e63', 22);
            spawnParticles(ent.x, ent.y, '#d7ccc8', 10);
            spawnDamageText(ent.x, ent.y - 30, 'WITHERED', '#8d6e63', true);
        }
    });
}

// Make fish projectiles visibly home in. This sits outside the old projectile loop and corrects their movement every frame.
function updateAquamarineProjectiles() {
    projectiles.forEach(p => {
        if (!p || p.dead || p.type !== 'fish') return;

        let target = p.targetId ? entities.find(en => en.id === p.targetId && en.hp > 0) : null;
        if (!target) {
            target = entities
                .filter(en => en.team !== p.team && en.hp > 0 && en.type !== 'turret' && en.type !== 'boid' && en.type !== 'mammoth_mount')
                .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];
            if (target) p.targetId = target.id;
        }

        if (target) {
            const desired = Math.atan2(target.y - p.y, target.x - p.x);
            const current = Math.atan2(p.vy, p.vx);
            let diff = desired - current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const turn = p.turnRate || 0.13;
            const nextAngle = current + clamp(diff, -turn, turn);
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 7.5;

            p.vx = Math.cos(nextAngle) * speed;
            p.vy = Math.sin(nextAngle) * speed;
        }
    });
}

if (typeof applyAI === 'function' && !window.__ballBattleSpecialAIWrapped) {
    window.__ballBattleSpecialAIWrapped = true;
    const __baseApplyAI = applyAI;

    applyAI = function patchedApplyAI(e) {
        if (!e) return;
        if (!isSetupPhase) {
            if (e.type === 'mammoth_mount') {
                handleMammothMountAI(e);
                return;
            }

            if (e.type === 'mammoth') {
                handleMammothRiderAI(e);
                return;
            }

            if (e.type === 'aquamarine') {
                handleAquamarineAI(e);
                return;
            }

            if (e.type === 'trapper' && typeof handleEliteTrapperAI === 'function') {
                handleEliteTrapperAI(e);
                return;
            }

            if (e.type === 'bard' && typeof handleBardPrecastAI === 'function' && handleBardPrecastAI(e)) {
                return;
            }
        }

        __baseApplyAI(e);
    };
}

if (typeof update === 'function' && !window.__ballBattleProjectileWrapped) {
    window.__ballBattleProjectileWrapped = true;
    const __baseUpdate = update;

    update = function patchedUpdate() {
        updateAquamarineProjectiles();
        __baseUpdate();
    };
}


window.addEventListener('DOMContentLoaded', () => { if (typeof showRow === 'function') showRow(1); });



/* --- FINAL MAMMOTH STABILITY PATCH ---
   Keeps the rider attached to the mount after physics/collision resolution and prevents rider/mount jitter. */
function stabilizeMammothRiders() {
    if (!Array.isArray(entities)) return;

    entities.forEach(rider => {
        if (!rider || rider.type !== 'mammoth') return;

        const mount = rider.mammothId
            ? entities.find(ent => ent && ent.id === rider.mammothId && ent.type === 'mammoth_mount' && ent.hp > 0)
            : null;

        if (!mount || rider.hp <= 0) {
            if (rider.hp <= 0) killOwnedMammothMount(rider.id);
            return;
        }

        // Draw mount before rider so the rider is visible on top instead of buried inside it.
        const mountIndex = entities.indexOf(mount);
        const riderIndex = entities.indexOf(rider);
        if (mountIndex > -1 && riderIndex > -1 && mountIndex > riderIndex) {
            entities.splice(mountIndex, 1);
            const newRiderIndex = entities.indexOf(rider);
            entities.splice(Math.max(0, newRiderIndex), 0, mount);
        }

        rider.isMounted = true;
        rider.x = mount.x;
        rider.y = mount.y - mount.radius * 0.55;
        rider.vx = 0;
        rider.vy = 0;
        rider.angle = mount.angle || rider.angle || 0;
        rider.teleportCooldown = Math.max(rider.teleportCooldown || 0, 2);
    });
}

function handleMammothMountAI(e) {
    if (!e || e.type !== 'mammoth_mount') return false;

    const owner = entities.find(ent => ent && ent.id === e.ownerId && ent.hp > 0);
    if (!owner) {
        e.hp = 0;
        spawnParticles(e.x, e.y, '#8d6e63', 14);
        return true;
    }

    const target = (owner.target && owner.target.hp > 0) ? owner.target : findClosestEnemyFor(owner);
    e.target = target || null;

    if (target) {
        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        let diff = angle - (e.angle || 0);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        e.angle = (e.angle || 0) + clamp(diff, -0.08, 0.08);

        // Heavy mount acceleration. Smooth enough to avoid shaking, strong enough to charge.
        e.vx += Math.cos(e.angle) * 0.34;
        e.vy += Math.sin(e.angle) * 0.34;
    } else {
        // Idle near its rider.
        const dx = owner.x - e.x;
        const dy = owner.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;

        if (d > 42) {
            const angle = Math.atan2(dy, dx);
            e.angle = angle;
            e.vx += Math.cos(angle) * 0.18;
            e.vy += Math.sin(angle) * 0.18;
        }
    }

    // Keep it inside the arena with soft wall steering.
    const pad = e.radius + 8;
    if (e.x < pad) e.vx += 0.65;
    if (e.x > canvas.width - pad) e.vx -= 0.65;
    if (e.y < pad) e.vy += 0.65;
    if (e.y > canvas.height - pad) e.vy -= 0.65;

    // Smooth damping removes the "seizure" look from accumulated collision impulses.
    e.vx *= 0.965;
    e.vy *= 0.965;

    const maxSpeed = 4.8;
    const speed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (speed > maxSpeed) {
        e.vx = e.vx / speed * maxSpeed;
        e.vy = e.vy / speed * maxSpeed;
    }

    return true;
}

function handleMammothRiderAI(e) {
    if (!e || e.type !== 'mammoth') return false;

    const target = findClosestEnemyFor(e);
    if (target) {
        e.target = target;
    }

    const mount = ensureMammothMount(e);
    if (mount && mount.hp > 0) {
        if (target) {
            mount.target = target;
        }

        // Rider is not a separate moving ball while mounted.
        e.x = mount.x;
        e.y = mount.y - mount.radius * 0.55;
        e.vx = 0;
        e.vy = 0;
        e.angle = mount.angle || e.angle || 0;
        e.isMounted = true;

        updateMammothRider(e);
        return true;
    }

    return true;
}

function updateMammothRider(e) {
    if (!e || e.type !== 'mammoth' || e.hp <= 0) return;

    const mount = ensureMammothMount(e);
    if (!mount || mount.hp <= 0) return;

    if (e.mammothStompCooldown === undefined) e.mammothStompCooldown = 0;
    if (e.mammothStompCooldown > 0) e.mammothStompCooldown--;

    const enemies = getEnemyCandidatesFor(e);
    enemies.forEach(enemy => {
        if (!enemy || enemy.hp <= 0 || enemy.type === 'mammoth_mount') return;

        const d = getDistance(mount, enemy);
        if (d < mount.radius + enemy.radius + 14) {
            const angle = Math.atan2(enemy.y - mount.y, enemy.x - mount.x);

            if (e.mammothStompCooldown <= 0) {
                damageEntity(enemy, 8.5, enemy.x, enemy.y, e);
                enemy.vx += Math.cos(angle) * 8.5;
                enemy.vy += Math.sin(angle) * 8.5;
                spawnParticles(enemy.x, enemy.y, '#8d6e63', 12);
                spawnDamageText(enemy.x, enemy.y - 32, 'TRAMPLE', '#8d6e63', true);
                e.mammothStompCooldown = 26;
                if (typeof playSound === 'function') playSound('heavy_hit', 0.45);
            } else {
                enemy.vx += Math.cos(angle) * 0.65;
                enemy.vy += Math.sin(angle) * 0.65;
            }
        }
    });
}

if (typeof update === 'function' && !window.__ballBattleMammothStabilizeWrapped) {
    window.__ballBattleMammothStabilizeWrapped = true;
    const __mammothBaseUpdate = update;

    update = function mammothStabilizedUpdate() {
        __mammothBaseUpdate();
        stabilizeMammothRiders();
    };
}


/* --- FARREL FINAL PATCH: resizable controls, visible count inputs, mammoth names, fish latch AI --- */
(function finalUiAndCreaturePatch() {
    function clampFinal(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function applyControlPanelHeight(height) {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;

        const safeHeight = clampFinal(Number(height) || 150, 118, 360);
        document.documentElement.style.setProperty('--control-panel-height', `${safeHeight}px`);
        panel.dataset.controlHeight = String(safeHeight);

        try {
            localStorage.setItem('ballBattleControlPanelHeight', String(safeHeight));
        } catch (err) {
            // Storage can fail in private/file modes; the UI still works for this session.
        }
    }

    function initControlPanelResizer() {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;

        let handle = document.getElementById('controlResizeHandle');
        if (!handle) {
            handle = document.createElement('div');
            handle.id = 'controlResizeHandle';
            handle.className = 'control-resize-handle';
            handle.title = 'Drag to resize control panel height';
            panel.appendChild(handle);
        }

        let savedHeight = 180;
        try {
            savedHeight = Number(localStorage.getItem('ballBattleControlPanelHeight')) || 180;
        } catch (err) {
            savedHeight = 180;
        }

        applyControlPanelHeight(savedHeight);

        let startY = 0;
        let startHeight = 0;
        let dragging = false;

        function onMove(event) {
            if (!dragging) return;
            const pointerY = event.clientY ?? (event.touches && event.touches[0] ? event.touches[0].clientY : startY);
            const nextHeight = startHeight + (pointerY - startY);
            applyControlPanelHeight(nextHeight);
            event.preventDefault();
        }

        function onUp() {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('is-resizing-controls');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }

        handle.addEventListener('pointerdown', event => {
            dragging = true;
            startY = event.clientY;
            startHeight = panel.getBoundingClientRect().height;
            document.body.classList.add('is-resizing-controls');
            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            event.preventDefault();
        });
    }

    function fixCountInputsNow() {
        ['p1Count', 'p2Count', 'fsP1Count', 'fsP2Count', 'cameraFighterNumber'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.style.minWidth = id === 'cameraFighterNumber' ? '38px' : '52px';
            input.style.textAlign = 'center';
            input.style.fontWeight = '900';
        });
    }

    function getOwnerNameForMammoth(mount) {
        if (!mount) return null;
        const owner = entities.find(ent => ent && ent.id === mount.ownerId);
        if (!owner) return null;

        if (owner.displayName) return owner.displayName;
        if (owner.nameIndex) return `Fighter ${owner.nameIndex}`;

        const num = typeof getFighterNumber === 'function' ? getFighterNumber(owner) : null;
        if (num) return `Fighter ${num}`;

        return 'Rider';
    }

    const previousGetEntityName = typeof getEntityName === 'function' ? getEntityName : null;
    window.getMammothMountLabel = function getMammothMountLabel(mount) {
        const ownerName = getOwnerNameForMammoth(mount);
        return ownerName ? `${ownerName}'s Mammoth` : 'Mammoth';
    };

    if (previousGetEntityName) {
        getEntityName = function patchedGetEntityName(e) {
            if (e && e.type === 'mammoth_mount') {
                return window.getMammothMountLabel(e);
            }

            return previousGetEntityName(e);
        };
    }

    const previousEnsureMammothMount = typeof ensureMammothMount === 'function' ? ensureMammothMount : null;
    if (previousEnsureMammothMount) {
        ensureMammothMount = function patchedEnsureMammothMount(rider) {
            const mount = previousEnsureMammothMount(rider);

            if (mount && rider) {
                mount.displayName = `${rider.displayName || (rider.nameIndex ? `Fighter ${rider.nameIndex}` : 'Rider')}'s Mammoth`;
                mount.originalType = 'mammoth_mount';
                mount.realType = 'mammoth_mount';
                mount.type = 'mammoth_mount';
                mount.ownerId = rider.id;
                mount.radius = Math.max(mount.radius || 0, 38);
                mount.mass = Math.max(mount.mass || 0, 7.5);
                mount.bravery = 1;
                mount.frictionOverride = 0.94;
            }

            return mount;
        };
    }

    // Smoother, less twitchy mammoth mount. This intentionally overrides earlier versions.
    handleMammothMountAI = function patchedStableMammothMountAI(e) {
        if (!e || e.type !== 'mammoth_mount') return false;

        const owner = entities.find(ent => ent && ent.id === e.ownerId && ent.hp > 0);
        if (!owner) {
            e.hp = 0;
            spawnParticles(e.x, e.y, '#8d6e63', 14);
            return true;
        }

        const target = (owner.target && owner.target.hp > 0) ? owner.target : findClosestEnemyFor(owner);
        e.target = target || null;

        let desiredAngle = e.angle || 0;
        if (target) {
            desiredAngle = Math.atan2(target.y - e.y, target.x - e.x);
        } else {
            const dx = owner.x - e.x;
            const dy = owner.y - e.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            if (d > 48) desiredAngle = Math.atan2(dy, dx);
        }

        let diff = desiredAngle - (e.angle || 0);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Heavy animal turning: prevents frame-to-frame flip jitter.
        e.angle = (e.angle || 0) + clampFinal(diff, -0.045, 0.045);

        if (target) {
            const distance = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
            const accel = distance > 110 ? 0.28 : 0.18;
            e.vx += Math.cos(e.angle) * accel;
            e.vy += Math.sin(e.angle) * accel;
        }

        // Soft arena steering.
        const pad = (e.radius || 38) + 10;
        if (e.x < pad) e.vx += 0.72;
        if (e.x > canvas.width - pad) e.vx -= 0.72;
        if (e.y < pad) e.vy += 0.72;
        if (e.y > canvas.height - pad) e.vy -= 0.72;

        // Heavy damping. This is the main anti-seizure stabilizer.
        e.vx *= 0.925;
        e.vy *= 0.925;

        const maxSpeed = 3.9;
        const speed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (speed > maxSpeed) {
            e.vx = e.vx / speed * maxSpeed;
            e.vy = e.vy / speed * maxSpeed;
        }

        if (Math.abs(e.vx) < 0.035) e.vx = 0;
        if (Math.abs(e.vy) < 0.035) e.vy = 0;

        return true;
    };

    handleMammothRiderAI = function patchedStableMammothRiderAI(e) {
        if (!e || e.type !== 'mammoth') return false;

        const target = findClosestEnemyFor(e);
        if (target) e.target = target;

        const mount = ensureMammothMount(e);
        if (mount && mount.hp > 0) {
            if (target) mount.target = target;

            e.isMounted = true;
            e.x = mount.x;
            e.y = mount.y - (mount.radius || 38) * 0.62;
            e.vx = 0;
            e.vy = 0;
            e.angle = mount.angle || e.angle || 0;
            e.teleportCooldown = Math.max(e.teleportCooldown || 0, 3);

            updateMammothRider(e);
            return true;
        }

        return true;
    };

    stabilizeMammothRiders = function patchedStabilizeMammothRiders() {
        if (!Array.isArray(entities)) return;

        entities.forEach(rider => {
            if (!rider || rider.type !== 'mammoth') return;

            const mount = rider.mammothId
                ? entities.find(ent => ent && ent.id === rider.mammothId && ent.type === 'mammoth_mount' && ent.hp > 0)
                : null;

            if (!mount || rider.hp <= 0) {
                if (rider.hp <= 0 && typeof killOwnedMammothMount === 'function') killOwnedMammothMount(rider.id);
                return;
            }

            const mountIndex = entities.indexOf(mount);
            const riderIndex = entities.indexOf(rider);

            // Mount drawn first, rider drawn immediately after.
            if (mountIndex > -1 && riderIndex > -1 && mountIndex > riderIndex) {
                entities.splice(mountIndex, 1);
                const newRiderIndex = entities.indexOf(rider);
                entities.splice(Math.max(0, newRiderIndex), 0, mount);
            }

            rider.isMounted = true;
            rider.x = mount.x;
            rider.y = mount.y - (mount.radius || 38) * 0.62;
            rider.vx = 0;
            rider.vy = 0;
            rider.angle = mount.angle || rider.angle || 0;
            rider.teleportCooldown = Math.max(rider.teleportCooldown || 0, 3);

            // Make the mount ignore tiny physics jitter after resolution.
            mount.vx *= 0.94;
            mount.vy *= 0.94;
            if (Math.abs(mount.vx) < 0.035) mount.vx = 0;
            if (Math.abs(mount.vy) < 0.035) mount.vy = 0;
        });
    };

    // Better fish: they chase, can be swatted, and latch/eat for several seconds on hit.
    updateAquamarineProjectiles = function patchedAquamarineProjectiles() {
        projectiles.forEach(p => {
            if (!p || p.dead || p.type !== 'fish') return;

            if (p.fishHp === undefined) p.fishHp = 12;
            if (p.fishPhase === undefined) p.fishPhase = Math.random() * Math.PI * 2;

            if (p.latchedTargetId) {
                const target = entities.find(en => en && en.id === p.latchedTargetId && en.hp > 0);

                if (!target) {
                    p.dead = true;
                    return;
                }

                p.latchTimer = (p.latchTimer || 0) - 1;
                p.biteTick = (p.biteTick || 0) + 1;

                const orbit = (target.radius || 20) + 7;
                const angle = p.fishPhase + frameCount * 0.11;
                p.x = target.x + Math.cos(angle) * orbit;
                p.y = target.y + Math.sin(angle) * orbit;
                p.vx = target.vx || 0;
                p.vy = target.vy || 0;

                // Chewing effect: repeated small damage and drag.
                if (p.biteTick % 18 === 0) {
                    const source = entities.find(a => a && a.id === p.shooterId);
                    damageEntity(target, 2.4, p.x, p.y, source || null);
                    target.vx *= 0.82;
                    target.vy *= 0.82;
                    spawnParticles(p.x, p.y, '#00cec9', 4);
                    spawnDamageText(p.x, p.y - 14, 'CHOMP', '#00cec9');
                    if (typeof playSound === 'function') playSound('hit', 0.2);
                }

                if (p.latchTimer <= 0) {
                    p.dead = true;
                    spawnParticles(p.x, p.y, '#81ecec', 5);
                }

                return;
            }

            let target = p.targetId ? entities.find(en => en && en.id === p.targetId && en.hp > 0) : null;

            if (!target) {
                target = entities
                    .filter(en =>
                        en &&
                        en.team !== p.team &&
                        en.hp > 0 &&
                        en.type !== 'turret' &&
                        en.type !== 'boid' &&
                        en.type !== 'mammoth_mount'
                    )
                    .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];

                if (target) p.targetId = target.id;
            }

            if (!target) return;

            // Nearby enemies can kill fish before they latch.
            const closeDefender = entities
                .filter(en =>
                    en &&
                    en.team !== p.team &&
                    en.hp > 0 &&
                    !en.isDancing &&
                    !en.frozen &&
                    en.type !== 'turret' &&
                    en.type !== 'boid' &&
                    en.type !== 'mammoth_mount' &&
                    getDistance(p, en) < (en.radius || 20) + 34
                )
                .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];

            if (closeDefender && Math.random() < 0.055) {
                p.fishHp -= ['samurai', 'scythe', 'knight', 'lance', 'pirate', 'rogue', 'trapper', 'bard'].includes(closeDefender.type) ? 5 : 3;
                spawnParticles(p.x, p.y, '#dfe6e9', 2);

                if (p.fishHp <= 0) {
                    p.dead = true;
                    spawnDamageText(p.x, p.y - 12, 'SPLASH', '#81ecec');
                    spawnParticles(p.x, p.y, '#81ecec', 8);
                    if (typeof playSound === 'function') playSound('clash', 0.18);
                    return;
                }
            }

            const desired = Math.atan2(target.y - p.y, target.x - p.x);
            const current = Math.atan2(p.vy || 0, p.vx || 0);
            let diff = desired - current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const turn = p.turnRate || 0.18;
            const nextAngle = current + clampFinal(diff, -turn, turn);
            const speed = clampFinal((Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2) || 7.5) + 0.03, 6.2, 9.2);

            p.vx = Math.cos(nextAngle) * speed;
            p.vy = Math.sin(nextAngle) * speed;
        });
    };

    // Draw helper for latched fish without rewriting the whole draw loop.
    if (!window.__fishDrawOverlayWrapped && typeof draw === 'function') {
        window.__fishDrawOverlayWrapped = true;
        const previousDraw = draw;

        draw = function patchedDrawWithLatchedFishOverlay() {
            previousDraw();

            if (!Array.isArray(projectiles)) return;

            ctx.save();
            // The previous overlay was drawn in screen space. Re-apply the world camera transform
            // so latched fish stay glued to the target even while the camera tracks or zooms.
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(camera.zoom, camera.zoom);
            ctx.translate(-camera.x, -camera.y);

            projectiles.forEach(p => {
                if (!p || p.dead || p.type !== 'fish' || !p.latchedTargetId) return;

                const target = entities.find(en => en && en.id === p.latchedTargetId && en.hp > 0);
                if (!target) return;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(Math.atan2(target.y - p.y, target.x - p.x));

                ctx.fillStyle = '#00cec9';
                ctx.strokeStyle = '#003b46';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Open bite jaw.
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(8, -4);
                ctx.lineTo(17, 0);
                ctx.lineTo(8, 4);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#003b46';
                ctx.beginPath();
                ctx.arc(2, -2, 1.8, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();

                ctx.strokeStyle = 'rgba(0, 206, 201, 0.55)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(target.x, target.y, (target.radius || 20) + 10 + Math.sin(frameCount * 0.2) * 2, 0, Math.PI * 2);
                ctx.stroke();
            });
            ctx.restore();
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initControlPanelResizer();
            fixCountInputsNow();
        });
    } else {
        initControlPanelResizer();
        fixCountInputsNow();
    }

    // Keep input sizing correct after tabs/modes rebuild pieces of the UI.
    const previousShowRow = typeof showRow === 'function' ? showRow : null;
    if (previousShowRow && !window.__showRowResizeFixed) {
        window.__showRowResizeFixed = true;
        showRow = function patchedShowRow(rowNum) {
            previousShowRow(rowNum);
            fixCountInputsNow();
        };
    }
})();


/* --- FINAL UI STABILITY PATCH V2: fixed toggle + free resizer + squad visibility guard --- */
(function finalUiStabilityPatchV2() {
    const HEIGHT_KEY = 'ballBattleControlPanelHeightV2';

    function clampV2(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getMaxPanelHeight() {
        const viewport = window.innerHeight || 720;
        return Math.max(120, Math.floor(viewport * 0.82));
    }

    function applyControlPanelHeightV2(height) {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;

        const safeHeight = clampV2(Number(height) || 150, 54, getMaxPanelHeight());
        document.documentElement.style.setProperty('--control-panel-height', `${safeHeight}px`);
        panel.dataset.controlHeight = String(safeHeight);

        try {
            localStorage.setItem(HEIGHT_KEY, String(safeHeight));
            // Keep the old key synced so older code does not drag the panel back unexpectedly.
            localStorage.setItem('ballBattleControlPanelHeight', String(safeHeight));
        } catch (err) {
            // Storage can fail in private/file modes.
        }
    }

    function installControlPanelResizerV2() {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;

        let oldHandle = document.getElementById('controlResizeHandle');
        let handle = document.createElement('div');
        handle.id = 'controlResizeHandle';
        handle.className = 'control-resize-handle';
        handle.title = 'Drag to resize control panel height';
        if (oldHandle && oldHandle.parentNode) {
            oldHandle.parentNode.replaceChild(handle, oldHandle);
        } else {
            panel.appendChild(handle);
        }

        let savedHeight = 180;
        try {
            savedHeight =
                Number(localStorage.getItem(HEIGHT_KEY)) ||
                Number(localStorage.getItem('ballBattleControlPanelHeight')) ||
                180;
        } catch (err) {
            savedHeight = 180;
        }

        applyControlPanelHeightV2(savedHeight);

        let startY = 0;
        let startHeight = 0;
        let dragging = false;

        function onMove(event) {
            if (!dragging) return;
            const point = event.touches && event.touches[0] ? event.touches[0] : event;
            const pointerY = point.clientY || startY;
            const nextHeight = startHeight + (pointerY - startY);
            applyControlPanelHeightV2(nextHeight);
            event.preventDefault();
        }

        function onUp() {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('is-resizing-controls');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        }

        handle.addEventListener('pointerdown', event => {
            dragging = true;
            startY = event.clientY;
            startHeight = panel.getBoundingClientRect().height;
            document.body.classList.add('is-resizing-controls');
            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            event.preventDefault();
        });

        handle.addEventListener('touchstart', event => {
            const touch = event.touches && event.touches[0];
            if (!touch) return;
            dragging = true;
            startY = touch.clientY;
            startHeight = panel.getBoundingClientRect().height;
            document.body.classList.add('is-resizing-controls');
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
            event.preventDefault();
        }, { passive: false });

        window.addEventListener('resize', () => {
            const current = Number(panel.dataset.controlHeight) || savedHeight || 150;
            applyControlPanelHeightV2(current);
        });
    }

    function installControlToggleV2() {
        const panel = document.getElementById('controlsPanel');
        const btn = document.getElementById('toggleControlsBtn');
        if (!panel || !btn) return;

        window.controlsVisible = !panel.classList.contains('controls-hidden');

        window.toggleControls = function toggleControlsV2() {
            const controls = document.getElementById('controlsPanel');
            const toggleBtn = document.getElementById('toggleControlsBtn');
            if (!controls || !toggleBtn) return;

            window.controlsVisible = controls.classList.contains('controls-hidden');

            if (window.controlsVisible) {
                controls.classList.remove('controls-hidden');
                controls.style.removeProperty('display');
                toggleBtn.innerHTML = 'Hide Controls &#9650;';
                toggleBtn.style.backgroundColor = '#555';
                window.controlsVisible = true;
            } else {
                controls.classList.add('controls-hidden');
                controls.style.setProperty('display', 'none', 'important');
                toggleBtn.innerHTML = 'Show Controls &#9660;';
                toggleBtn.style.backgroundColor = '#2d3436';
                window.controlsVisible = false;
            }
        };
    }

    function normalizeCameraDockTextForFit() {
        const dock = document.getElementById('fullscreenCameraDock');
        if (!dock) return;

        const fold = document.getElementById('fullscreenCameraFoldBtn');
        if (fold && !document.body.classList.contains('watch-fullscreen-active')) {
            fold.textContent = 'Hide Cam';
        }

        const jumpLabel = dock.querySelector('.camera-jump span');
        if (jumpLabel) jumpLabel.textContent = 'Fighter';
    }

    function guardSquadTabFit() {
        const p1 = document.getElementById('p1SquadContainer');
        const p2 = document.getElementById('p2SquadContainer');
        [p1, p2].forEach(col => {
            if (!col) return;
            col.style.minHeight = '0';
            col.style.overflowY = 'auto';
            col.style.overflowX = 'hidden';
        });
    }

    function installV2() {
        installControlToggleV2();
        installControlPanelResizerV2();
        normalizeCameraDockTextForFit();
        guardSquadTabFit();

        // Keep the compact squad layout applied after the game regenerates the squad cards.
        const originalUpdateSquadUI = window.updateSquadUI;
        if (typeof originalUpdateSquadUI === 'function' && !originalUpdateSquadUI.__v2Wrapped) {
            const wrapped = function updateSquadUIV2Wrapper() {
                const result = originalUpdateSquadUI.apply(this, arguments);
                setTimeout(guardSquadTabFit, 0);
                return result;
            };
            wrapped.__v2Wrapped = true;
            window.updateSquadUI = wrapped;
        }

        if (typeof window.showRow === 'function' && !window.showRow.__v2Wrapped) {
            const oldShowRow = window.showRow;
            const showWrapped = function showRowV2Wrapper(rowNumber) {
                const result = oldShowRow.apply(this, arguments);
                setTimeout(() => {
                    guardSquadTabFit();
                    normalizeCameraDockTextForFit();
                }, 0);
                return result;
            };
            showWrapped.__v2Wrapped = true;
            window.showRow = showWrapped;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installV2);
    } else {
        installV2();
    }

    // Run once more after previous patches finish their own DOMContentLoaded handlers.
    setTimeout(installV2, 0);
    setTimeout(() => {
        guardSquadTabFit();
        normalizeCameraDockTextForFit();
    }, 250);
})();


/* --- FINAL UI STABILITY PATCH V2C: default height reset and dock compact observer --- */
(function finalUiStabilityPatchV2C() {
    function applyBetterDefaultHeightIfNeeded() {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;

        let saved = null;
        try {
            saved = localStorage.getItem('ballBattleControlPanelHeightV2');
        } catch (err) {
            saved = null;
        }

        if (!saved || Number(saved) <= 150) {
            const defaultHeight = 180;
            document.documentElement.style.setProperty('--control-panel-height', `${defaultHeight}px`);
            panel.dataset.controlHeight = String(defaultHeight);
            try {
                localStorage.setItem('ballBattleControlPanelHeightV2', String(defaultHeight));
                localStorage.setItem('ballBattleControlPanelHeight', String(defaultHeight));
            } catch (err) {}
        }
    }

    function updateCameraDockCompactClass() {
        const dock = document.getElementById('fullscreenCameraDock');
        if (!dock) return;

        const width = dock.getBoundingClientRect().width;
        dock.classList.toggle('dock-compact', width > 0 && width < 520);
    }

    function installDockObserver() {
        const dock = document.getElementById('fullscreenCameraDock');
        if (!dock) return;

        updateCameraDockCompactClass();

        if (typeof ResizeObserver !== 'undefined' && !dock.__dockCompactObserverInstalled) {
            dock.__dockCompactObserverInstalled = true;
            const observer = new ResizeObserver(updateCameraDockCompactClass);
            observer.observe(dock);
        }

        window.addEventListener('resize', updateCameraDockCompactClass);
    }

    function install() {
        applyBetterDefaultHeightIfNeeded();
        installDockObserver();
        setTimeout(updateCameraDockCompactClass, 100);
        setTimeout(updateCameraDockCompactClass, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();


/* --- FARREL SPEARER + BLOCKABLE FISH PATCH --- */
function angleDiffSmall(a, b) {
    let diff = a - b;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff);
}

function isFrontFacingBlock(defender, incomingX, incomingY) {
    if (!defender || defender.hp <= 0 || defender.trappedBy || defender.isDancing) return false;

    let isBlockingType =
        ((defender.type === 'unarmed' || defender.type === 'laser' || defender.type === 'chameleon' || defender.type === 'grower' || defender.type === 'duplicator' || defender.type === 'chrono' || defender.type === 'regenerator') && defender.isBlocking) ||
        (defender.type === 'knight') ||
        (defender.type === 'adapto' && defender.currentMode === 'shield');

    if (!isBlockingType) return false;

    const attackAngle = Math.atan2(incomingY - defender.y, incomingX - defender.x);
    return angleDiffSmall(attackAngle, defender.angle || 0) < 1.05;
}

function isFishBlockedByTarget(fish, target) {
    if (!fish || !target) return false;
    return isFrontFacingBlock(target, fish.x, fish.y);
}

function setFishSwarmBlocked(fish, target) {
    if (!fish || !target) return;

    fish.blockedTargetId = target.id;
    fish.targetId = target.id;
    fish.latchedTargetId = null;
    fish.swarmWaitTimer = Math.max(fish.swarmWaitTimer || 0, 70);
    fish.fishPhase = fish.fishPhase || Math.random() * Math.PI * 2;
    fish.life = Math.max(fish.life || 0, 90);

    const orbit = (target.radius || 20) + 36;
    const angle = (target.angle || 0) + Math.PI + Math.sin(frameCount * 0.11 + fish.fishPhase) * 0.9;
    const desiredX = target.x + Math.cos(angle) * orbit;
    const desiredY = target.y + Math.sin(angle) * orbit;

    fish.vx = (desiredX - fish.x) * 0.16;
    fish.vy = (desiredY - fish.y) * 0.16;

    if (frameCount % 18 === 0) {
        spawnParticles(fish.x, fish.y, '#81ecec', 3);
        spawnDamageText(fish.x, fish.y - 12, 'SWARM', '#81ecec');
        if (typeof playSound === 'function') playSound('clash', 0.12);
    }
}

function findSpearSkewerAnchor(spear, target) {
    if (!spear || !target) return null;

    const nearWall =
        target.x < (target.radius || 20) + 34 ||
        target.x > canvas.width - ((target.radius || 20) + 34) ||
        target.y < (target.radius || 20) + 34 ||
        target.y > canvas.height - ((target.radius || 20) + 34);

    if (nearWall) {
        return { type: 'wall', x: target.x, y: target.y };
    }

    const nearObject = obstacles.find(o =>
        o &&
        o.type !== 'lava' &&
        o.type !== 'ice' &&
        Math.sqrt((target.x - o.x) ** 2 + (target.y - o.y) ** 2) < (target.radius || 20) + (o.radius || 20) + 28
    );

    if (nearObject) {
        return { type: 'object', object: nearObject, x: nearObject.x, y: nearObject.y };
    }

    const nearBody = entities.find(other =>
        other &&
        other.id !== target.id &&
        other.hp > 0 &&
        other.type !== 'turret' &&
        other.type !== 'boid' &&
        Math.sqrt((target.x - other.x) ** 2 + (target.y - other.y) ** 2) < (target.radius || 20) + (other.radius || 20) + 30
    );

    if (nearBody) {
        return { type: 'entity', entity: nearBody, x: nearBody.x, y: nearBody.y };
    }

    return null;
}

function pinTargetWithSpear(target, spear, source, anchor) {
    if (!target || !spear) return;

    const duration = spear.spearKind === 'bounce' ? 80 : 120;
    target.spearPinnedTimer = Math.max(target.spearPinnedTimer || 0, duration);
    target.spearPinSourceId = source ? source.id : spear.shooterId;
    target.spearPinKind = spear.spearKind || 'normal';
    target.spearPinAngle = Math.atan2(spear.vy || 0, spear.vx || 0);
    target.spearPinAnchorType = anchor ? anchor.type : 'none';
    target.spearPinX = target.x;
    target.spearPinY = target.y;
    target.spearBreakHp = 16 + Math.random() * 10;
    target.frozen = Math.max(target.frozen || 0, 8);
    target.vx *= 0.08;
    target.vy *= 0.08;

    if (anchor && anchor.entity) {
        target.spearPinnedToId = anchor.entity.id;
        anchor.entity.spearPinnedTimer = Math.max(anchor.entity.spearPinnedTimer || 0, Math.floor(duration * 0.55));
        anchor.entity.frozen = Math.max(anchor.entity.frozen || 0, 5);
        anchor.entity.vx *= 0.2;
        anchor.entity.vy *= 0.2;
    } else {
        target.spearPinnedToId = null;
    }

    spawnParticles(target.x, target.y, '#dfe6e9', 10);
    spawnDamageText(target.x, target.y - 34, anchor && anchor.type === 'entity' ? 'SKEWERED' : 'PINNED', '#f5f5dc', true);
    if (typeof playSound === 'function') playSound('slash', 0.45);
}

function handleSpearProjectileHit(p, target, source) {
    if (!p || !target || target.hp <= 0) return;
    if (target.type === 'mammoth_mount' && source && source.type === 'mammoth') return;

    if (isFrontFacingBlock(target, p.x, p.y)) {
        const reductionText = target.type === 'knight' || target.type === 'adapto' ? 'SHIELD' : 'BLOCK';
        spawnParticles(p.x, p.y, '#dfe6e9', 9);
        spawnDamageText(p.x, p.y - 18, reductionText, '#81ecec', true);
        target.vx += (p.vx || 0) * 0.05;
        target.vy += (p.vy || 0) * 0.05;

        if (p.spearKind === 'bounce' && (p.bouncesLeft || 0) > 0) {
            p.bouncesLeft--;
            const angle = Math.atan2(p.vy || 0, p.vx || 0) + Math.PI + (Math.random() - 0.5) * 0.9;
            const speed = 12;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            return;
        }

        p.dead = true;
        return;
    }

    if (p.spearKind === 'explosive') {
        damageEntity(target, 8, p.x, p.y, source || null);
        triggerExplosion(p.x, p.y, 125, 44, p.shooterId || (source && source.id) || null);
        p.dead = true;
        return;
    }

    const anchor = findSpearSkewerAnchor(p, target);
    if (anchor) {
        damageEntity(target, p.spearKind === 'bounce' ? 8 : 11, p.x, p.y, source || null);
        pinTargetWithSpear(target, p, source || null, anchor);
    } else {
        damageEntity(target, p.spearKind === 'bounce' ? 10 : 14, p.x, p.y, source || null);
        target.vx += (p.vx || 0) * 0.45;
        target.vy += (p.vy || 0) * 0.45;
        spawnParticles(p.x, p.y, '#dfe6e9', 5);
    }

    p.dead = true;
}

function handleSpearObstacleImpact(p, obstacle, shooter) {
    if (!p || p.dead || p.type !== 'spear' || !obstacle) return false;

    if (p.spearKind === 'explosive') {
        triggerExplosion(p.x, p.y, 130, 45, p.shooterId || (shooter && shooter.id) || null);
        p.dead = true;
        return true;
    }

    if (p.spearKind === 'bounce' && (p.bouncesLeft || 0) > 0) {
        const nx = p.x - obstacle.x;
        const ny = p.y - obstacle.y;
        const nLen = Math.sqrt(nx * nx + ny * ny) || 1;
        const ux = nx / nLen;
        const uy = ny / nLen;
        const dot = (p.vx || 0) * ux + (p.vy || 0) * uy;

        p.vx = (p.vx || 0) - 2 * dot * ux;
        p.vy = (p.vy || 0) - 2 * dot * uy;
        p.bouncesLeft--;
        p.x += ux * 8;
        p.y += uy * 8;
        spawnParticles(p.x, p.y, '#74b9ff', 6);
        if (typeof playSound === 'function') playSound('clash', 0.3);
        return true;
    }

    obstacle.hp -= 9;
    p.dead = true;
    spawnParticles(p.x, p.y, '#dfe6e9', 8);
    spawnDamageText(p.x, p.y - 16, 'STUCK', '#f5f5dc');
    return true;
}

function pickSpearerTarget(e) {
    const enemies = entities.filter(t =>
        t &&
        t.hp > 0 &&
        t.team !== e.team &&
        t.type !== 'turret' &&
        t.type !== 'boid' &&
        t.type !== 'mammoth_mount' &&
        !t.isStealthed
    );

    let best = null;
    let bestScore = -Infinity;

    enemies.forEach(t => {
        const d = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
        if (d > 720) return;

        const anchor = findSpearSkewerAnchor({ x: e.x, y: e.y, vx: t.x - e.x, vy: t.y - e.y }, t);
        const cluster = entities.filter(other =>
            other &&
            other.id !== t.id &&
            other.hp > 0 &&
            Math.sqrt((other.x - t.x) ** 2 + (other.y - t.y) ** 2) < 92
        ).length;

        let score = 500 - d;
        if (anchor) score += 230;
        if (cluster >= 2) score += 160;
        if (safeHasLineOfSight(e, t)) score += 90;
        if (t.spearPinnedTimer > 0) score -= 180;

        if (score > bestScore) {
            bestScore = score;
            best = t;
        }
    });

    return best;
}

function chooseSpearKind(e, target) {
    if (!e || !target) return 'normal';

    const clusterEnemies = entities.filter(other =>
        other &&
        other.team !== e.team &&
        other.hp > 0 &&
        Math.sqrt((other.x - target.x) ** 2 + (other.y - target.y) ** 2) < 90
    ).length;

    const explosiveReady = (e.explosiveSpearCooldown || 0) <= 0;
    const bounceReady = (e.bounceSpearCooldown || 0) <= 0;
    const hasLos = safeHasLineOfSight(e, target);

    const barrelNear = obstacles.some(o =>
        o &&
        o.type === 'barrel' &&
        Math.sqrt((o.x - target.x) ** 2 + (o.y - target.y) ** 2) < 115
    );

    if (explosiveReady && (clusterEnemies >= 2 || barrelNear)) return 'explosive';
    if (bounceReady && !hasLos) return 'bounce';
    if (bounceReady && Math.random() < 0.14) return 'bounce';

    return 'normal';
}

function throwSpearProjectile(e, target, kind = 'normal') {
    if (!e || !target) return false;

    const lead = Math.min(18, Math.max(0, getDistance(e, target) / 45));
    const aimX = target.x + (target.vx || 0) * lead;
    const aimY = target.y + (target.vy || 0) * lead;
    const angle = Math.atan2(aimY - e.y, aimX - e.x);

    e.angle = angle;

    const speed = kind === 'bounce' ? 15.5 : 14.2;

    projectiles.push({
        x: e.x + Math.cos(angle) * ((e.radius || 20) + 18),
        y: e.y + Math.sin(angle) * ((e.radius || 20) + 18),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        team: e.team,
        life: kind === 'bounce' ? 115 : 95,
        type: 'spear',
        spearKind: kind,
        shooterId: e.id,
        radius: 7,
        bouncesLeft: kind === 'bounce' ? 3 : 0
    });

    spawnMuzzleFlash(e, angle, kind === 'explosive' ? 'cannon' : 'bullet');
    spawnParticles(e.x + Math.cos(angle) * 18, e.y + Math.sin(angle) * 18, kind === 'explosive' ? '#ff7675' : '#dfe6e9', 5);

    if (kind === 'explosive') {
        e.explosiveSpearCooldown = 210;
        spawnDamageText(e.x, e.y - 28, 'BOMB SPEAR', '#ff7675', true);
    } else if (kind === 'bounce') {
        e.bounceSpearCooldown = 150;
        spawnDamageText(e.x, e.y - 28, 'BOUNCE SPEAR', '#74b9ff', true);
    }

    if (typeof playSound === 'function') playSound('arrow', 0.5);
    return true;
}

function handleSpearerAI(e) {
    if (!e || e.type !== 'spearer' || e.hp <= 0 || isSetupPhase || e.isDancing) return false;

    if (e.spearCooldown === undefined) e.spearCooldown = 35;
    if (e.explosiveSpearCooldown === undefined) e.explosiveSpearCooldown = 150;
    if (e.bounceSpearCooldown === undefined) e.bounceSpearCooldown = 100;

    if (e.spearCooldown > 0) e.spearCooldown--;
    if (e.explosiveSpearCooldown > 0) e.explosiveSpearCooldown--;
    if (e.bounceSpearCooldown > 0) e.bounceSpearCooldown--;

    const target = pickSpearerTarget(e);
    if (!target) return true;

    e.target = target;
    const d = getDistance(e, target);
    const angle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = angle;

    if (d < 150) {
        e.vx -= Math.cos(angle) * 0.55;
        e.vy -= Math.sin(angle) * 0.55;
    } else if (d > 430) {
        e.vx += Math.cos(angle) * 0.33;
        e.vy += Math.sin(angle) * 0.33;
    } else {
        const side = Math.sin(frameCount * 0.035 + e.id * 11) > 0 ? 1 : -1;
        e.vx += Math.cos(angle + Math.PI / 2 * side) * 0.13;
        e.vy += Math.sin(angle + Math.PI / 2 * side) * 0.13;
    }

    if (e.spearCooldown <= 0 && d < 690) {
        const kind = chooseSpearKind(e, target);

        if (kind === 'bounce' || safeHasLineOfSight(e, target)) {
            throwSpearProjectile(e, target, kind);
            e.spearCooldown = kind === 'normal' ? 48 : 70;
        }
    }

    return true;
}

function updateSpearPinnedEntities() {
    entities.forEach(e => {
        if (!e || !e.spearPinnedTimer || e.spearPinnedTimer <= 0) return;

        e.spearPinnedTimer--;
        e.frozen = Math.max(e.frozen || 0, 3);

        if (e.spearPinnedToId) {
            const anchor = entities.find(a => a && a.id === e.spearPinnedToId && a.hp > 0);
            if (anchor) {
                e.x = e.x * 0.82 + anchor.x * 0.18;
                e.y = e.y * 0.82 + anchor.y * 0.18;
            }
        } else if (e.spearPinAnchorType === 'wall' || e.spearPinAnchorType === 'object') {
            e.x = e.spearPinX;
            e.y = e.spearPinY;
        }

        e.vx *= 0.08;
        e.vy *= 0.08;

        if (frameCount % 20 === 0) {
            spawnParticles(e.x, e.y, '#f5f5dc', 2);
            e.spearBreakHp -= 2.5;
        }

        if (e.spearBreakHp <= 0 || e.spearPinnedTimer <= 0) {
            spawnParticles(e.x, e.y, '#dfe6e9', 8);
            spawnDamageText(e.x, e.y - 24, 'SPEAR BROKE', '#dfe6e9');
            e.spearPinnedTimer = 0;
            e.spearPinnedToId = null;
        }
    });
}

function updateSpearWallBouncesPost() {
    projectiles.forEach(p => {
        if (!p || p.dead || p.type !== 'spear') return;

        const margin = 8;
        const hitX = p.x < margin || p.x > canvas.width - margin;
        const hitY = p.y < margin || p.y > canvas.height - margin;

        if (!hitX && !hitY) return;

        if (p.spearKind === 'explosive') {
            triggerExplosion(clamp(p.x, margin, canvas.width - margin), clamp(p.y, margin, canvas.height - margin), 120, 40, p.shooterId || null);
            p.dead = true;
            return;
        }

        if (p.spearKind === 'bounce' && (p.bouncesLeft || 0) > 0) {
            if (hitX) p.vx *= -1;
            if (hitY) p.vy *= -1;
            p.x = clamp(p.x, margin, canvas.width - margin);
            p.y = clamp(p.y, margin, canvas.height - margin);
            p.bouncesLeft--;
            p.life = Math.max(p.life, 45);
            spawnParticles(p.x, p.y, '#74b9ff', 7);
            if (typeof playSound === 'function') playSound('clash', 0.3);
        } else {
            p.dead = true;
            spawnParticles(clamp(p.x, margin, canvas.width - margin), clamp(p.y, margin, canvas.height - margin), '#dfe6e9', 6);
        }
    });
}

// Add/update spearer data even if the original literal was loaded before this patch.
if (typeof FIGHTER_DATA !== 'undefined') {
    FIGHTER_DATA.spearer = FIGHTER_DATA.spearer || {
        hp: 105,
        dmg: 'Pierce',
        ability: 'Skewer Spear Kit',
        desc: 'Throws normal, explosive, and bouncing spears. Pins enemies near walls, objects, or other balls.'
    };
}

if (typeof FIGHTER_OPTIONS !== 'undefined' && !FIGHTER_OPTIONS.includes('spearer')) {
    FIGHTER_OPTIONS.push('spearer');
    FIGHTER_OPTIONS.sort();
}

if (typeof FIGHTER_VISUALS !== 'undefined') {
    FIGHTER_VISUALS.aquamarine = FIGHTER_VISUALS.aquamarine || { tag: 'AQ', color: '#00cec9', accent: '#81ecec' };
    FIGHTER_VISUALS.mammoth = FIGHTER_VISUALS.mammoth || { tag: 'MM', color: '#8d6e63', accent: '#d7ccc8' };
    FIGHTER_VISUALS.mammoth_mount = FIGHTER_VISUALS.mammoth_mount || { tag: 'MT', color: '#6d4c41', accent: '#d7ccc8' };
    FIGHTER_VISUALS.spearer = FIGHTER_VISUALS.spearer || { tag: 'SR', color: '#7f8c8d', accent: '#f5f5dc' };
}

(function installSpearerAndFishFinalPatch() {
    if (typeof applyAI === 'function' && !applyAI.__spearerWrapped) {
        const previousApplyAI = applyAI;
        const wrappedApplyAI = function spearerApplyAIWrapper(e) {
            if (handleSpearerAI(e)) return;
            return previousApplyAI.apply(this, arguments);
        };
        wrappedApplyAI.__spearerWrapped = true;
        applyAI = wrappedApplyAI;
    }

    // Override the existing fish steering with block-aware swarming.
    updateAquamarineProjectiles = function blockAwareAquamarineProjectiles() {
        projectiles.forEach(p => {
            if (!p || p.dead || p.type !== 'fish') return;

            if (p.fishHp === undefined) p.fishHp = 12;
            if (p.fishPhase === undefined) p.fishPhase = Math.random() * Math.PI * 2;

            if (p.latchedTargetId) {
                const target = entities.find(en => en && en.id === p.latchedTargetId && en.hp > 0);

                if (!target) {
                    p.dead = true;
                    return;
                }

                p.latchTimer = (p.latchTimer || 0) - 1;
                p.biteTick = (p.biteTick || 0) + 1;

                const orbit = (target.radius || 20) + 7;
                const angle = p.fishPhase + frameCount * 0.11;
                p.x = target.x + Math.cos(angle) * orbit;
                p.y = target.y + Math.sin(angle) * orbit;
                p.vx = target.vx || 0;
                p.vy = target.vy || 0;

                if (p.biteTick % 18 === 0) {
                    const source = entities.find(a => a && a.id === p.shooterId);
                    damageEntity(target, 2.4, p.x, p.y, source || null);
                    target.vx *= 0.82;
                    target.vy *= 0.82;
                    spawnParticles(p.x, p.y, '#00cec9', 4);
                    spawnDamageText(p.x, p.y - 14, 'CHOMP', '#00cec9');
                    if (typeof playSound === 'function') playSound('hit', 0.2);
                }

                if (p.latchTimer <= 0) {
                    p.dead = true;
                    spawnParticles(p.x, p.y, '#81ecec', 5);
                }

                return;
            }

            let target = p.targetId ? entities.find(en => en && en.id === p.targetId && en.hp > 0) : null;

            if (!target) {
                target = entities
                    .filter(en =>
                        en &&
                        en.team !== p.team &&
                        en.hp > 0 &&
                        en.type !== 'turret' &&
                        en.type !== 'boid' &&
                        en.type !== 'mammoth_mount'
                    )
                    .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];

                if (target) p.targetId = target.id;
            }

            if (!target) return;

            if (isFishBlockedByTarget(p, target)) {
                setFishSwarmBlocked(p, target);
                return;
            }

            if (p.blockedTargetId === target.id) {
                p.swarmWaitTimer = Math.max((p.swarmWaitTimer || 0) - 1, 0);
                if (p.swarmWaitTimer > 0 && getDistance(p, target) < (target.radius || 20) + 52) {
                    const orbit = (target.radius || 20) + 34;
                    const angle = p.fishPhase + frameCount * 0.13;
                    const desiredX = target.x + Math.cos(angle) * orbit;
                    const desiredY = target.y + Math.sin(angle) * orbit;
                    p.vx = (desiredX - p.x) * 0.16;
                    p.vy = (desiredY - p.y) * 0.16;
                    return;
                }
                p.blockedTargetId = null;
            }

            const closeDefender = entities
                .filter(en =>
                    en &&
                    en.team !== p.team &&
                    en.hp > 0 &&
                    !en.isDancing &&
                    !en.frozen &&
                    en.type !== 'turret' &&
                    en.type !== 'boid' &&
                    en.type !== 'mammoth_mount' &&
                    getDistance(p, en) < (en.radius || 20) + 34
                )
                .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];

            if (closeDefender && !isFishBlockedByTarget(p, closeDefender) && Math.random() < 0.045) {
                p.fishHp -= ['samurai', 'scythe', 'knight', 'lance', 'pirate', 'rogue', 'trapper', 'bard', 'spearer'].includes(closeDefender.type) ? 5 : 3;
                spawnParticles(p.x, p.y, '#dfe6e9', 2);

                if (p.fishHp <= 0) {
                    p.dead = true;
                    spawnDamageText(p.x, p.y - 12, 'SPLASH', '#81ecec');
                    spawnParticles(p.x, p.y, '#81ecec', 8);
                    if (typeof playSound === 'function') playSound('clash', 0.18);
                    return;
                }
            }

            const desired = Math.atan2(target.y - p.y, target.x - p.x);
            const current = Math.atan2(p.vy || 0, p.vx || 0);
            let diff = desired - current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const turn = p.turnRate || 0.18;
            const nextAngle = current + clamp(diff, -turn, turn);
            const speed = Math.max(6.2, Math.min(9.2, (Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2) || 7.5) + 0.03));

            p.vx = Math.cos(nextAngle) * speed;
            p.vy = Math.sin(nextAngle) * speed;
        });
    };

    if (typeof update === 'function' && !update.__spearerFinalWrapped) {
        const previousUpdate = update;
        const wrappedUpdate = function spearerFinalUpdateWrapper() {
            updateSpearPinnedEntities();
            const result = previousUpdate.apply(this, arguments);
            updateSpearPinnedEntities();
            updateSpearWallBouncesPost();
            return result;
        };
        wrappedUpdate.__spearerFinalWrapped = true;
        update = wrappedUpdate;
    }

    if (typeof draw === 'function' && !draw.__spearOverlayWrapped) {
        const previousDraw = draw;
        const wrappedDraw = function spearOverlayDrawWrapper() {
            previousDraw.apply(this, arguments);

            ctx.save();

            // Draw pin spears over pinned bodies.
            entities.forEach(e => {
                if (!e || !e.spearPinnedTimer || e.spearPinnedTimer <= 0) return;

                ctx.save();
                ctx.translate(e.x, e.y);
                ctx.rotate(e.spearPinAngle || 0);
                ctx.strokeStyle = '#8d6e63';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(-e.radius - 16, 0);
                ctx.lineTo(e.radius + 22, 0);
                ctx.stroke();

                ctx.fillStyle = '#dfe6e9';
                ctx.strokeStyle = '#2d3436';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(e.radius + 22, -6);
                ctx.lineTo(e.radius + 38, 0);
                ctx.lineTo(e.radius + 22, 6);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            });

            // Draw blocked fish swarm rings.
            projectiles.forEach(p => {
                if (!p || p.dead || p.type !== 'fish' || !p.blockedTargetId) return;
                const target = entities.find(en => en && en.id === p.blockedTargetId && en.hp > 0);
                if (!target) return;

                ctx.strokeStyle = 'rgba(129, 236, 236, 0.55)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(target.x, target.y, (target.radius || 20) + 35 + Math.sin(frameCount * 0.25 + (p.fishPhase || 0)) * 3, 0, Math.PI * 2);
                ctx.stroke();
            });

            ctx.restore();
        };
        wrappedDraw.__spearOverlayWrapped = true;
        draw = wrappedDraw;
    }
})();



/* --- FARREL FISH THREAT + SPEARER COMBAT REWORK PATCH --- */
function getLiveEnemyFishThreatsFor(fighter, radius = 170) {
    if (!fighter || fighter.hp <= 0 || typeof projectiles === 'undefined') return [];

    return projectiles
        .filter(p =>
            p &&
            !p.dead &&
            p.type === 'fish' &&
            p.team !== fighter.team &&
            !p.latchedTargetId &&
            getDistance(p, fighter) <= radius
        )
        .sort((a, b) => {
            const aBlocked = a.blockedTargetId === fighter.id ? 80 : 0;
            const bBlocked = b.blockedTargetId === fighter.id ? 80 : 0;
            return (getDistance(a, fighter) - aBlocked) - (getDistance(b, fighter) - bBlocked);
        });
}

function getFishThreatPressure(fighter, radius = 170) {
    return getLiveEnemyFishThreatsFor(fighter, radius).length;
}

function canFighterActAgainstFish(fighter) {
    return !!(
        fighter &&
        fighter.hp > 0 &&
        !fighter.isDancing &&
        !fighter.trappedBy &&
        !(fighter.frozen > 0)
    );
}

function damageFishThreat(fish, amount, label = 'FISH HIT', color = '#b2bec3') {
    if (!fish || fish.dead) return false;

    fish.fishHp = (fish.fishHp === undefined ? 12 : fish.fishHp) - amount;
    spawnParticles(fish.x, fish.y, color, 4);

    if (fish.fishHp <= 0) {
        fish.dead = true;
        spawnDamageText(fish.x, fish.y - 14, label, color, true);
        spawnParticles(fish.x, fish.y, '#81ecec', 10);
        if (typeof playSound === 'function') playSound('clash', 0.2);
        return true;
    }

    return false;
}

function reactToEnemyFishThreat(fighter) {
    if (!canFighterActAgainstFish(fighter)) return false;
    if (fighter.type === 'turret' || fighter.type === 'boid' || fighter.type === 'mammoth_mount') return false;

    const fishThreats = getLiveEnemyFishThreatsFor(fighter, 175);
    if (fishThreats.length === 0) return false;

    const fish = fishThreats[0];
    const d = getDistance(fighter, fish);
    const angleToFish = Math.atan2(fish.y - fighter.y, fish.x - fighter.x);
    fighter.angle = angleToFish;

    const blockingTypes = ['unarmed', 'laser', 'chameleon', 'grower', 'duplicator', 'chrono', 'regenerator'];
    const weaponTypes = ['samurai', 'scythe', 'knight', 'lance', 'pirate', 'rogue', 'trapper', 'bard', 'fight knight', 'spearer'];
    const rangedTypes = ['soldier', 'bow', 'wizard', 'engineer', 'dual gunner', 'alchemist', 'laser'];
    const heavyTypes = ['tank', 'mammoth', 'hardcase', 'big'];

    if (blockingTypes.includes(fighter.type) && d < 125) {
        if ((fighter.blockCooldown || 0) <= 0 || fighter.isBlocking) {
            fighter.isBlocking = true;
            fighter.blockTimer = Math.max(fighter.blockTimer || 0, 28);
            fighter.vx *= 0.82;
            fighter.vy *= 0.82;
            if (frameCount % 18 === 0) {
                spawnDamageText(fighter.x, fighter.y - 30, 'FISH BLOCK', '#81ecec');
                spawnParticles(fighter.x + Math.cos(angleToFish) * (fighter.radius + 6), fighter.y + Math.sin(angleToFish) * (fighter.radius + 6), '#81ecec', 2);
            }
            return true;
        }
    }

    if (fighter.type === 'adapto' && d < 135) {
        fighter.currentMode = 'shield';
        fighter.vx -= Math.cos(angleToFish) * 0.25;
        fighter.vy -= Math.sin(angleToFish) * 0.25;
        if (frameCount % 16 === 0) spawnDamageText(fighter.x, fighter.y - 30, 'SHIELD FISH', '#81ecec');
        return true;
    }

    if (weaponTypes.includes(fighter.type) && d < 105) {
        const hitPower = fighter.type === 'spearer' ? 7.5 : fighter.type === 'samurai' ? 8 : fighter.type === 'scythe' ? 7 : 6;
        if (frameCount % 5 === 0 || Math.random() < 0.12) {
            damageFishThreat(fish, hitPower, 'FISH CUT', '#dfe6e9');
            fighter.vx -= Math.cos(angleToFish) * 0.18;
            fighter.vy -= Math.sin(angleToFish) * 0.18;
        }
        return true;
    }

    if (rangedTypes.includes(fighter.type) && d < 155) {
        if (frameCount % 9 === 0) {
            damageFishThreat(fish, fighter.type === 'wizard' ? 6 : 4.5, fighter.type === 'wizard' ? 'ZAP FISH' : 'FISH SHOT', fighter.type === 'wizard' ? '#00ffff' : '#dfe6e9');
            spawnParticles((fighter.x + fish.x) / 2, (fighter.y + fish.y) / 2, fighter.type === 'wizard' ? '#00ffff' : '#dfe6e9', 2);
        }

        if (d < 95 && fighter.type !== 'laser') {
            fighter.vx -= Math.cos(angleToFish) * 0.35;
            fighter.vy -= Math.sin(angleToFish) * 0.35;
            return true;
        }

        return false;
    }

    if (heavyTypes.includes(fighter.type) && fishThreats.length >= 3 && d < 120) {
        if (frameCount % 12 === 0) {
            fishThreats.slice(0, 3).forEach(f => damageFishThreat(f, 5.5, 'CRUSH FISH', '#8d6e63'));
        }
        return false;
    }

    if (d < 75) {
        fighter.vx -= Math.cos(angleToFish) * 0.38;
        fighter.vy -= Math.sin(angleToFish) * 0.38;
        return true;
    }

    return false;
}

function spearerMeleeShove(spearer, target) {
    if (!spearer || !target || target.hp <= 0) return false;

    const angle = Math.atan2(target.y - spearer.y, target.x - spearer.x);
    spearer.angle = angle;

    const spearTipX = spearer.x + Math.cos(angle) * ((spearer.radius || 20) + 40);
    const spearTipY = spearer.y + Math.sin(angle) * ((spearer.radius || 20) + 40);

    damageEntity(target, 4.5, spearTipX, spearTipY, spearer);

    target.vx += Math.cos(angle) * 8.5;
    target.vy += Math.sin(angle) * 8.5;
    spearer.vx -= Math.cos(angle) * 4.2;
    spearer.vy -= Math.sin(angle) * 4.2;

    spearer.spearMeleeCooldown = 42;
    spearer.spearRetreatTimer = 40;
    spearer.spearCooldown = Math.max(spearer.spearCooldown || 0, 20);

    spawnParticles(spearTipX, spearTipY, '#f5f5dc', 8);
    spawnDamageText(target.x, target.y - 30, 'SPEAR SHOVE', '#f5f5dc', true);
    if (typeof playSound === 'function') playSound('slash', 0.42);

    return true;
}

// Replaces the previous Spearer throw tuning.
// Bouncing spears now behave like arena pinballs and do not expire quickly.
throwSpearProjectile = function upgradedThrowSpearProjectile(e, target, kind = 'normal') {
    if (!e || !target) return false;

    const lead = Math.min(22, Math.max(0, getDistance(e, target) / 42));
    const aimX = target.x + (target.vx || 0) * lead;
    const aimY = target.y + (target.vy || 0) * lead;
    const angle = Math.atan2(aimY - e.y, aimX - e.x);

    e.angle = angle;

    const speed = kind === 'bounce' ? 16.2 : kind === 'explosive' ? 13.5 : 14.8;

    projectiles.push({
        x: e.x + Math.cos(angle) * ((e.radius || 20) + 22),
        y: e.y + Math.sin(angle) * ((e.radius || 20) + 22),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        team: e.team,
        life: kind === 'bounce' ? 9999 : 105,
        type: 'spear',
        spearKind: kind,
        shooterId: e.id,
        radius: kind === 'explosive' ? 8 : 7,
        bouncesLeft: kind === 'bounce' ? 999 : 0,
        persistentBounce: kind === 'bounce',
        maxSpearAge: kind === 'bounce' ? 1500 : 105,
        spearAge: 0
    });

    spawnMuzzleFlash(e, angle, kind === 'explosive' ? 'cannon' : 'bullet');
    spawnParticles(e.x + Math.cos(angle) * 18, e.y + Math.sin(angle) * 18, kind === 'explosive' ? '#ff7675' : (kind === 'bounce' ? '#74b9ff' : '#dfe6e9'), 5);

    if (kind === 'explosive') {
        e.explosiveSpearCooldown = 210;
        spawnDamageText(e.x, e.y - 28, 'BOMB SPEAR', '#ff7675', true);
    } else if (kind === 'bounce') {
        e.bounceSpearCooldown = 180;
        spawnDamageText(e.x, e.y - 28, 'PINBALL SPEAR', '#74b9ff', true);
    }

    if (typeof playSound === 'function') playSound('arrow', 0.5);
    return true;
};

handleSpearProjectileHit = function upgradedHandleSpearProjectileHit(p, target, source) {
    if (!p || !target || target.hp <= 0) return;
    if (target.type === 'mammoth_mount' && source && source.type === 'mammoth') return;

    const incomingAngle = Math.atan2(p.vy || 0, p.vx || 0);
    const knockX = Math.cos(incomingAngle);
    const knockY = Math.sin(incomingAngle);

    if (isFrontFacingBlock(target, p.x, p.y)) {
        const reductionText = target.type === 'knight' || target.type === 'adapto' ? 'SHIELD' : 'BLOCK';
        spawnParticles(p.x, p.y, '#dfe6e9', 9);
        spawnDamageText(p.x, p.y - 18, reductionText, '#81ecec', true);
        target.vx += (p.vx || 0) * 0.08;
        target.vy += (p.vy || 0) * 0.08;

        if (p.spearKind === 'bounce') {
            const angle = incomingAngle + Math.PI + (Math.random() - 0.5) * 0.8;
            const speed = Math.max(12, Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2));
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.life = 9999;
            p.spearAge = (p.spearAge || 0) + 25;
            return;
        }

        p.dead = true;
        return;
    }

    if (p.spearKind === 'explosive') {
        damageEntity(target, 8, p.x, p.y, source || null);
        target.vx += knockX * 4.5;
        target.vy += knockY * 4.5;
        triggerExplosion(p.x, p.y, 125, 44, p.shooterId || (source && source.id) || null);
        p.dead = true;
        return;
    }

    const anchor = findSpearSkewerAnchor(p, target);
    const isNormal = !p.spearKind || p.spearKind === 'normal';

    if (anchor) {
        damageEntity(target, p.spearKind === 'bounce' ? 8 : 11, p.x, p.y, source || null);

        if (isNormal) {
            target.vx += knockX * 5.5;
            target.vy += knockY * 5.5;
        }

        pinTargetWithSpear(target, p, source || null, anchor);
    } else {
        damageEntity(target, p.spearKind === 'bounce' ? 10 : 14, p.x, p.y, source || null);

        const pushPower = isNormal ? 9.5 : 6.0;
        target.vx += knockX * pushPower;
        target.vy += knockY * pushPower;
        spawnParticles(p.x, p.y, '#dfe6e9', 5);
        if (isNormal) spawnDamageText(target.x, target.y - 25, 'KNOCKBACK', '#f5f5dc');
    }

    p.dead = true;
};

handleSpearObstacleImpact = function upgradedHandleSpearObstacleImpact(p, obstacle, shooter) {
    if (!p || p.dead || p.type !== 'spear' || !obstacle) return false;

    if (p.spearKind === 'explosive') {
        triggerExplosion(p.x, p.y, 130, 45, p.shooterId || (shooter && shooter.id) || null);
        p.dead = true;
        return true;
    }

    if (p.spearKind === 'bounce') {
        const nx = p.x - obstacle.x;
        const ny = p.y - obstacle.y;
        const nLen = Math.sqrt(nx * nx + ny * ny) || 1;
        const ux = nx / nLen;
        const uy = ny / nLen;
        const dot = (p.vx || 0) * ux + (p.vy || 0) * uy;
        const speed = Math.max(12.5, Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2));

        p.vx = ((p.vx || 0) - 2 * dot * ux);
        p.vy = ((p.vy || 0) - 2 * dot * uy);

        const newLen = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
        p.vx = (p.vx / newLen) * speed;
        p.vy = (p.vy / newLen) * speed;
        p.x += ux * 10;
        p.y += uy * 10;
        p.life = 9999;
        p.spearAge = (p.spearAge || 0) + 20;

        spawnParticles(p.x, p.y, '#74b9ff', 6);
        if (typeof playSound === 'function') playSound('clash', 0.25);
        return true;
    }

    obstacle.hp -= 9;
    p.dead = true;
    spawnParticles(p.x, p.y, '#dfe6e9', 8);
    spawnDamageText(p.x, p.y - 16, 'STUCK', '#f5f5dc');
    return true;
};

updateSpearWallBouncesPost = function upgradedUpdateSpearWallBouncesPost() {
    projectiles.forEach(p => {
        if (!p || p.dead || p.type !== 'spear') return;

        if (p.spearKind === 'bounce') {
            p.spearAge = (p.spearAge || 0) + 1;
            p.life = 9999;

            const stillHasEnemy = entities.some(e =>
                e &&
                e.hp > 0 &&
                e.team !== p.team &&
                e.type !== 'turret' &&
                e.type !== 'boid' &&
                e.type !== 'mammoth_mount'
            );

            if (!stillHasEnemy || p.spearAge > (p.maxSpearAge || 1500)) {
                p.dead = true;
                spawnParticles(p.x, p.y, '#74b9ff', 6);
                return;
            }
        }

        const margin = 8;
        const hitX = p.x < margin || p.x > canvas.width - margin;
        const hitY = p.y < margin || p.y > canvas.height - margin;

        if (!hitX && !hitY) return;

        if (p.spearKind === 'explosive') {
            triggerExplosion(clamp(p.x, margin, canvas.width - margin), clamp(p.y, margin, canvas.height - margin), 120, 40, p.shooterId || null);
            p.dead = true;
            return;
        }

        if (p.spearKind === 'bounce') {
            if (hitX) p.vx *= -1;
            if (hitY) p.vy *= -1;
            p.x = clamp(p.x, margin, canvas.width - margin);
            p.y = clamp(p.y, margin, canvas.height - margin);
            p.life = 9999;
            spawnParticles(p.x, p.y, '#74b9ff', 7);
            if (typeof playSound === 'function') playSound('clash', 0.25);
        } else {
            p.dead = true;
            spawnParticles(clamp(p.x, margin, canvas.width - margin), clamp(p.y, margin, canvas.height - margin), '#dfe6e9', 6);
        }
    });
};

handleSpearerAI = function upgradedHandleSpearerAI(e) {
    if (!e || e.type !== 'spearer' || e.hp <= 0 || isSetupPhase || e.isDancing) return false;

    if (e.spearCooldown === undefined) e.spearCooldown = 25;
    if (e.explosiveSpearCooldown === undefined) e.explosiveSpearCooldown = 150;
    if (e.bounceSpearCooldown === undefined) e.bounceSpearCooldown = 80;
    if (e.spearMeleeCooldown === undefined) e.spearMeleeCooldown = 0;
    if (e.spearRetreatTimer === undefined) e.spearRetreatTimer = 0;

    if (e.spearCooldown > 0) e.spearCooldown--;
    if (e.explosiveSpearCooldown > 0) e.explosiveSpearCooldown--;
    if (e.bounceSpearCooldown > 0) e.bounceSpearCooldown--;
    if (e.spearMeleeCooldown > 0) e.spearMeleeCooldown--;
    if (e.spearRetreatTimer > 0) e.spearRetreatTimer--;

    const fishThreat = getLiveEnemyFishThreatsFor(e, 140)[0];
    if (fishThreat && reactToEnemyFishThreat(e)) {
        return true;
    }

    const target = pickSpearerTarget(e);
    if (!target) return true;

    e.target = target;
    const d = getDistance(e, target);
    const angle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = angle;

    const meleeRange = (e.radius || 20) + (target.radius || 20) + 42;

    if (d < meleeRange && e.spearMeleeCooldown <= 0) {
        spearerMeleeShove(e, target);
        return true;
    }

    if (e.spearRetreatTimer > 0 || d < 185) {
        e.vx -= Math.cos(angle) * 0.68;
        e.vy -= Math.sin(angle) * 0.68;

        const side = Math.sin(frameCount * 0.075 + e.id * 3) > 0 ? 1 : -1;
        e.vx += Math.cos(angle + Math.PI / 2 * side) * 0.20;
        e.vy += Math.sin(angle + Math.PI / 2 * side) * 0.20;
    } else if (d > 500) {
        e.vx += Math.cos(angle) * 0.34;
        e.vy += Math.sin(angle) * 0.34;
    } else {
        const side = Math.sin(frameCount * 0.035 + e.id * 11) > 0 ? 1 : -1;
        e.vx += Math.cos(angle + Math.PI / 2 * side) * 0.17;
        e.vy += Math.sin(angle + Math.PI / 2 * side) * 0.17;
    }

    if (e.spearCooldown <= 0 && d < 720) {
        const kind = chooseSpearKind(e, target);

        if (kind === 'bounce' || safeHasLineOfSight(e, target)) {
            throwSpearProjectile(e, target, kind);
            e.spearCooldown = kind === 'normal' ? 46 : 72;
        }
    }

    return true;
};

(function installFishThreatAwarenessAIWrapper() {
    if (typeof applyAI === 'function' && !applyAI.__fishThreatAware) {
        const previousApplyAI = applyAI;
        const wrappedApplyAI = function fishThreatAwareApplyAI(e) {
            if (reactToEnemyFishThreat(e)) return;
            return previousApplyAI.apply(this, arguments);
        };
        wrappedApplyAI.__fishThreatAware = true;
        applyAI = wrappedApplyAI;
    }

    if (typeof FIGHTER_DATA !== 'undefined' && FIGHTER_DATA.spearer) {
        FIGHTER_DATA.spearer.desc = 'Throws normal, explosive, and persistent bouncing spears. Shoves close enemies away with melee spear control.';
    }
})();



/* --- FARREL POWER PATCH: SPEARER BUFF + SPIDER/BOMBMAN/MISSILE --- */
(function farrelPowerPatch() {
    const NEW_FIGHTER_KEYS = ['spider', 'bombman', 'missile'];

    function fpDist(a, b) {
        if (!a || !b) return 999999;
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    function fpAngle(from, to) {
        return Math.atan2((to.y || 0) - (from.y || 0), (to.x || 0) - (from.x || 0));
    }

    function fpClamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function fpEnemyCandidates(unit, includeMounts = false) {
        if (!unit || typeof entities === 'undefined') return [];
        return entities.filter(other =>
            other &&
            other.hp > 0 &&
            other.team !== unit.team &&
            other.id !== unit.id &&
            other.type !== 'turret' &&
            other.type !== 'boid' &&
            (includeMounts || other.type !== 'mammoth_mount') &&
            !other.isStealthed &&
            !other.isFeigning
        );
    }

    function fpClosestEnemy(unit, maxRange = 99999) {
        let best = null;
        let bestD = maxRange;
        fpEnemyCandidates(unit).forEach(enemy => {
            const d = fpDist(unit, enemy);
            if (d < bestD) {
                bestD = d;
                best = enemy;
            }
        });
        return best;
    }

    function fpAvoidEdges(unit, padding = 62, force = 0.75) {
        if (!unit) return;
        if (unit.x < padding) unit.vx += force;
        if (unit.x > canvas.width - padding) unit.vx -= force;
        if (unit.y < padding) unit.vy += force;
        if (unit.y > canvas.height - padding) unit.vy -= force;
    }

    function fpProjectileDanger(unit, p, radius = 180) {
        if (!unit || !p || p.dead || p.team === unit.team || p.isMine) return 0;
        if (p.type === 'fish' && p.latchedTargetId) return 0;
        if (fpDist(unit, p) > radius) return 0;

        const pvx = p.vx || 0;
        const pvy = p.vy || 0;
        const speed = Math.sqrt(pvx * pvx + pvy * pvy);
        if (speed < 0.1) return 0;

        const toUnitX = unit.x - p.x;
        const toUnitY = unit.y - p.y;
        const closing = (toUnitX * pvx + toUnitY * pvy) / (Math.sqrt(toUnitX * toUnitX + toUnitY * toUnitY) * speed || 1);

        if (closing < 0.35) return 0;

        let threat = speed * closing;
        if (p.type === 'cannonball' || p.isHomingMissile) threat += 8;
        if (p.type === 'spear') threat += 6;
        if (p.type === 'fish') threat += 5;
        if (p.type === 'orb' || p.type === 'fireball') threat += 5;
        if (p.type === 'bullet' || p.type === 'arrow' || p.type === 'flaming_arrow') threat += 3;
        return threat;
    }

    function fpIncomingProjectiles(unit, radius = 190) {
        if (typeof projectiles === 'undefined') return [];
        return projectiles
            .filter(p => fpProjectileDanger(unit, p, radius) > 0)
            .sort((a, b) => fpDist(unit, a) - fpDist(unit, b));
    }

    function fpEvadeProjectiles(unit, radius = 190, force = 0.75) {
        const incoming = fpIncomingProjectiles(unit, radius);
        if (incoming.length === 0) return false;

        const p = incoming[0];
        const away = Math.atan2(unit.y - p.y, unit.x - p.x);
        const travel = Math.atan2(p.vy || 0, p.vx || 0);
        const side = Math.sin((frameCount || 0) * 0.19 + unit.id * 37) > 0 ? 1 : -1;
        const dodgeAngle = travel + Math.PI / 2 * side;

        unit.vx += Math.cos(dodgeAngle) * force;
        unit.vy += Math.sin(dodgeAngle) * force;
        unit.vx += Math.cos(away) * force * 0.35;
        unit.vy += Math.sin(away) * force * 0.35;
        unit.angle = away;

        return true;
    }

    function fpIsStrongEnoughToHurtBombman(source, amount = 0) {
        if (!source) return amount >= 44;

        const strongTypes = [
            'bombman', 'mammoth', 'mammoth_mount', 'fight knight',
            'devourer', 'grower', 'crux', 'hardcase'
        ];

        if (strongTypes.includes(source.type) || strongTypes.includes(source.realType)) return true;
        if ((source.type === 'spatial' || source.type === 'spearer') && amount >= 20) return true;
        if (source.type === 'laser' && source.laserMode === 'death') return true;
        if (amount >= 44) return true;

        return false;
    }

    function fpRegisterFighters() {
        if (typeof FIGHTER_DATA !== 'undefined') {
            FIGHTER_DATA.spearer = {
                hp: 145,
                dmg: 'Pierce+',
                ability: 'Elite Skewer + Evasive Spearwork',
                desc: 'Buffed skirmisher. Throws faster spears, shoves nearby enemies back, evades projectiles, and can control several unarmed fighters alone.'
            };

            FIGHTER_DATA.spider = {
                hp: 135,
                dmg: 'Heavy/Web',
                ability: 'Web Pin + Precog Dodge',
                desc: 'Telegraphs heavy strikes, dodges attacks and projectiles, blocks if too late, and fires webs that pull or pin enemies.'
            };

            FIGHTER_DATA.bombman = {
                hp: 280,
                dmg: 'Fatal',
                ability: 'Bomb Body',
                desc: 'A super-heavy bruiser. One-shots unarmed fighters and rocks, never blocks, tanks weak attacks, and only true heavy hitters meaningfully damage him.'
            };

            FIGHTER_DATA.missile = {
                hp: 115,
                dmg: 'Homing',
                ability: 'Triple Missile Launcher',
                desc: 'Keeps distance and fires up to three homing missiles that curve into enemies and detonate on impact.'
            };
        }

        if (typeof FIGHTER_OPTIONS !== 'undefined') {
            NEW_FIGHTER_KEYS.concat(['spearer']).forEach(type => {
                if (!FIGHTER_OPTIONS.includes(type)) FIGHTER_OPTIONS.push(type);
            });
            FIGHTER_OPTIONS.sort();
        }

        if (typeof FIGHTER_VISUALS !== 'undefined') {
            FIGHTER_VISUALS.spearer = { tag: 'SR', color: '#5f6f7a', accent: '#f5f5dc' };
            FIGHTER_VISUALS.spider = { tag: 'SP', color: '#111111', accent: '#8e44ad' };
            FIGHTER_VISUALS.bombman = { tag: 'BM', color: '#2d3436', accent: '#ff4757' };
            FIGHTER_VISUALS.missile = { tag: 'MS', color: '#34495e', accent: '#ffa502' };
        }
    }

    fpRegisterFighters();

    if (typeof applyClassProps === 'function' && !applyClassProps.__farrelPowerWrapped) {
        const previousApplyClassProps = applyClassProps;

        applyClassProps = function farrelPowerApplyClassProps(fighter, type) {
            previousApplyClassProps.apply(this, arguments);

            if (!fighter) return;

            if (type === 'spearer') {
                fighter.mass = 1.45;
                fighter.reach = 760;
                fighter.bravery = 0.92;
                fighter.spearCooldown = Math.min(fighter.spearCooldown || 18, 18);
                fighter.explosiveSpearCooldown = Math.min(fighter.explosiveSpearCooldown || 95, 95);
                fighter.bounceSpearCooldown = Math.min(fighter.bounceSpearCooldown || 65, 65);
                fighter.spearMeleeCooldown = fighter.spearMeleeCooldown || 0;
                fighter.spearRetreatTimer = fighter.spearRetreatTimer || 0;
                fighter.spearEvasionTimer = fighter.spearEvasionTimer || 0;
            }

            if (type === 'spider') {
                fighter.mass = 1.65;
                fighter.reach = 420;
                fighter.bravery = 0.88;
                fighter.webCooldown = 25;
                fighter.spiderStrikeCooldown = 0;
                fighter.spiderDodgeCooldown = 0;
                fighter.spiderTelegraphTimer = 0;
                fighter.spiderTelegraphTargetId = null;
                fighter.blockTimer = fighter.blockTimer || 0;
                fighter.blockCooldown = fighter.blockCooldown || 0;
                fighter.isBlocking = false;
            }

            if (type === 'bombman') {
                fighter.mass = 4.6;
                fighter.radius = Math.max(fighter.radius || 20, 24);
                fighter.reach = 85;
                fighter.bravery = 1.0;
                fighter.bombPunchCooldown = 0;
                fighter.bombShockwaveCooldown = 0;
                fighter.isBlocking = false;
                fighter.blockCooldown = 999999;
                fighter.blockTimer = 0;
            }

            if (type === 'missile') {
                fighter.mass = 1.2;
                fighter.reach = 760;
                fighter.bravery = 0.62;
                fighter.missileCooldown = 20;
                fighter.missileBurstLeft = 0;
                fighter.missileBurstGap = 0;
            }
        };

        applyClassProps.__farrelPowerWrapped = true;
    }

    if (typeof damageEntity === 'function' && !damageEntity.__farrelPowerWrapped) {
        const previousDamageEntity = damageEntity;

        damageEntity = function farrelPowerDamageEntity(victim, amount, impactX, impactY, source) {
            if (victim && victim.hp > 0 && amount > 0) {
                if (victim.type === 'bombman') {
                    const strong = fpIsStrongEnoughToHurtBombman(source, amount);

                    if (!strong) {
                        if ((frameCount || 0) % 17 === 0) {
                            spawnDamageText(victim.x, victim.y - 34, 'NO SELL', '#ff4757', true);
                            spawnParticles(impactX || victim.x, impactY || victim.y, '#2d3436', 4);
                        }

                        amount *= 0.03;
                        victim.vx *= 0.85;
                        victim.vy *= 0.85;
                    } else {
                        amount *= 0.62;
                        if ((frameCount || 0) % 11 === 0) {
                            spawnDamageText(victim.x, victim.y - 34, 'ARMOR CRACK', '#ffa502', true);
                        }
                    }
                }

                if (victim.type === 'spider' && victim.isBlocking && !victim.trappedBy) {
                    const incomingAngle = Math.atan2((impactY || victim.y) - victim.y, (impactX || victim.x) - victim.x);
                    const faceDiff = angleDiffSmall(incomingAngle, victim.angle || 0);

                    if (faceDiff < 1.15) {
                        amount *= 0.28;
                        victim.vx *= 0.85;
                        victim.vy *= 0.85;
                        if ((frameCount || 0) % 8 === 0) {
                            spawnDamageText(victim.x, victim.y - 28, 'WEB BLOCK', '#8e44ad');
                            spawnParticles(impactX || victim.x, impactY || victim.y, '#dfe6e9', 3);
                        }
                    }
                }
            }

            return previousDamageEntity.call(this, victim, amount, impactX, impactY, source);
        };

        damageEntity.__farrelPowerWrapped = true;
    }

    spearerMeleeShove = function eliteSpearerMeleeShove(spearer, target) {
        if (!spearer || !target || target.hp <= 0) return false;

        const angle = fpAngle(spearer, target);
        spearer.angle = angle;

        const spearTipX = spearer.x + Math.cos(angle) * ((spearer.radius || 20) + 48);
        const spearTipY = spearer.y + Math.sin(angle) * ((spearer.radius || 20) + 48);

        const damage = target.type === 'unarmed' ? 12.5 : 8.0;
        damageEntity(target, damage, spearTipX, spearTipY, spearer);

        target.vx += Math.cos(angle) * 12.5;
        target.vy += Math.sin(angle) * 12.5;
        spearer.vx -= Math.cos(angle) * 7.0;
        spearer.vy -= Math.sin(angle) * 7.0;

        spearer.spearMeleeCooldown = 26;
        spearer.spearRetreatTimer = 48;
        spearer.spearCooldown = Math.max(spearer.spearCooldown || 0, 10);

        spawnParticles(spearTipX, spearTipY, '#f5f5dc', 12);
        spawnDamageText(target.x, target.y - 32, 'ELITE SHOVE', '#f5f5dc', true);
        if (typeof playSound === 'function') playSound('slash', 0.5);

        return true;
    };

    if (typeof throwSpearProjectile === 'function') {
        throwSpearProjectile = function eliteThrowSpearProjectile(e, target, kind = 'normal') {
            if (!e || !target) return false;

            const lead = Math.min(28, Math.max(0, fpDist(e, target) / 35));
            const aimX = target.x + (target.vx || 0) * lead;
            const aimY = target.y + (target.vy || 0) * lead;
            const angle = Math.atan2(aimY - e.y, aimX - e.x);

            e.angle = angle;

            const speed = kind === 'bounce' ? 17.6 : kind === 'explosive' ? 14.5 : 16.3;

            projectiles.push({
                x: e.x + Math.cos(angle) * ((e.radius || 20) + 24),
                y: e.y + Math.sin(angle) * ((e.radius || 20) + 24),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                team: e.team,
                life: kind === 'bounce' ? 9999 : 128,
                type: 'spear',
                spearKind: kind,
                shooterId: e.id,
                radius: kind === 'explosive' ? 8 : 7,
                bouncesLeft: kind === 'bounce' ? 999 : 0,
                persistentBounce: kind === 'bounce',
                maxSpearAge: kind === 'bounce' ? 1800 : 128,
                spearAge: 0
            });

            spawnMuzzleFlash(e, angle, kind === 'explosive' ? 'cannon' : 'bullet');
            spawnParticles(e.x + Math.cos(angle) * 20, e.y + Math.sin(angle) * 20, kind === 'explosive' ? '#ff7675' : (kind === 'bounce' ? '#74b9ff' : '#dfe6e9'), 7);

            if (kind === 'explosive') {
                e.explosiveSpearCooldown = 145;
                spawnDamageText(e.x, e.y - 28, 'BOMB SPEAR', '#ff7675', true);
            } else if (kind === 'bounce') {
                e.bounceSpearCooldown = 105;
                spawnDamageText(e.x, e.y - 28, 'PINBALL SPEAR', '#74b9ff', true);
            }

            if (typeof playSound === 'function') playSound('arrow', 0.55);
            return true;
        };
    }

    if (typeof handleSpearProjectileHit === 'function') {
        handleSpearProjectileHit = function eliteHandleSpearProjectileHit(p, target, source) {
            if (!p || !target || target.hp <= 0) return;
            if (target.type === 'mammoth_mount' && source && source.type === 'mammoth') return;

            const incomingAngle = Math.atan2(p.vy || 0, p.vx || 0);
            const knockX = Math.cos(incomingAngle);
            const knockY = Math.sin(incomingAngle);

            if (typeof isFrontFacingBlock === 'function' && isFrontFacingBlock(target, p.x, p.y)) {
                spawnParticles(p.x, p.y, '#dfe6e9', 9);
                spawnDamageText(p.x, p.y - 18, target.type === 'knight' || target.type === 'adapto' ? 'SHIELD' : 'BLOCK', '#81ecec', true);
                target.vx += (p.vx || 0) * 0.1;
                target.vy += (p.vy || 0) * 0.1;

                if (p.spearKind === 'bounce') {
                    const angle = incomingAngle + Math.PI + (Math.random() - 0.5) * 0.8;
                    const speed = Math.max(13.5, Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2));
                    p.vx = Math.cos(angle) * speed;
                    p.vy = Math.sin(angle) * speed;
                    p.life = 9999;
                    p.spearAge = (p.spearAge || 0) + 20;
                    return;
                }

                p.dead = true;
                return;
            }

            if (p.spearKind === 'explosive') {
                damageEntity(target, 10, p.x, p.y, source || null);
                target.vx += knockX * 6.0;
                target.vy += knockY * 6.0;
                triggerExplosion(p.x, p.y, 135, 48, p.shooterId || (source && source.id) || null);
                p.dead = true;
                return;
            }

            const anchor = findSpearSkewerAnchor(p, target);
            const isNormal = !p.spearKind || p.spearKind === 'normal';

            if (anchor) {
                damageEntity(target, p.spearKind === 'bounce' ? 10 : 15, p.x, p.y, source || null);

                if (isNormal) {
                    target.vx += knockX * 8.5;
                    target.vy += knockY * 8.5;
                }

                pinTargetWithSpear(target, p, source || null, anchor);
            } else {
                damageEntity(target, p.spearKind === 'bounce' ? 12 : 18, p.x, p.y, source || null);

                const pushPower = isNormal ? 13.5 : 7.5;
                target.vx += knockX * pushPower;
                target.vy += knockY * pushPower;
                spawnParticles(p.x, p.y, '#dfe6e9', 7);
                if (isNormal) spawnDamageText(target.x, target.y - 25, 'SPEAR BLAST', '#f5f5dc', true);
            }

            p.dead = true;
        };
    }

    function chooseEliteSpearKind(e, target) {
        if (!e || !target) return 'normal';

        const clusterEnemies = fpEnemyCandidates(e, true).filter(other => fpDist(other, target) < 95).length;
        const explosiveReady = (e.explosiveSpearCooldown || 0) <= 0;
        const bounceReady = (e.bounceSpearCooldown || 0) <= 0;
        const hasLos = safeHasLineOfSight(e, target);
        const anchor = findSpearSkewerAnchor({ x: e.x, y: e.y, vx: target.x - e.x, vy: target.y - e.y }, target);

        if (explosiveReady && clusterEnemies >= 2) return 'explosive';
        if (bounceReady && (!hasLos || anchor || Math.random() < 0.20)) return 'bounce';
        if (explosiveReady && Math.random() < 0.10) return 'explosive';
        return 'normal';
    }

    handleSpearerAI = function eliteHandleSpearerAI(e) {
        if (!e || e.type !== 'spearer' || e.hp <= 0 || isSetupPhase || e.isDancing) return false;

        if (e.spearCooldown === undefined) e.spearCooldown = 14;
        if (e.explosiveSpearCooldown === undefined) e.explosiveSpearCooldown = 95;
        if (e.bounceSpearCooldown === undefined) e.bounceSpearCooldown = 65;
        if (e.spearMeleeCooldown === undefined) e.spearMeleeCooldown = 0;
        if (e.spearRetreatTimer === undefined) e.spearRetreatTimer = 0;

        if (e.spearCooldown > 0) e.spearCooldown--;
        if (e.explosiveSpearCooldown > 0) e.explosiveSpearCooldown--;
        if (e.bounceSpearCooldown > 0) e.bounceSpearCooldown--;
        if (e.spearMeleeCooldown > 0) e.spearMeleeCooldown--;
        if (e.spearRetreatTimer > 0) e.spearRetreatTimer--;

        const projectileEvaded = fpEvadeProjectiles(e, 210, 0.95);

        const fishThreat = typeof getLiveEnemyFishThreatsFor === 'function' ? getLiveEnemyFishThreatsFor(e, 145)[0] : null;
        if (fishThreat && typeof reactToEnemyFishThreat === 'function' && reactToEnemyFishThreat(e)) return true;

        const enemies = fpEnemyCandidates(e);
        if (enemies.length === 0) return true;

        let target = null;
        let bestScore = -Infinity;

        enemies.forEach(enemy => {
            const d = fpDist(e, enemy);
            if (d > 790) return;

            const anchor = findSpearSkewerAnchor({ x: e.x, y: e.y, vx: enemy.x - e.x, vy: enemy.y - e.y }, enemy);
            const nearbyEnemies = enemies.filter(other => other.id !== enemy.id && fpDist(enemy, other) < 95).length;

            let score = 900 - d;
            if (enemy.type === 'unarmed') score += 180;
            if (anchor) score += 260;
            if (nearbyEnemies >= 1) score += 100;
            if (nearbyEnemies >= 2) score += 140;
            if (safeHasLineOfSight(e, enemy)) score += 80;
            if (enemy.spearPinnedTimer > 0) score -= 220;

            if (score > bestScore) {
                bestScore = score;
                target = enemy;
            }
        });

        if (!target) return true;

        e.target = target;
        const d = fpDist(e, target);
        const angle = fpAngle(e, target);
        e.angle = angle;

        const meleeRange = (e.radius || 20) + (target.radius || 20) + 52;
        if (d < meleeRange && e.spearMeleeCooldown <= 0) {
            spearerMeleeShove(e, target);
            return true;
        }

        const closeEnemies = enemies.filter(enemy => fpDist(e, enemy) < 190).length;
        const desiredGap = closeEnemies >= 2 ? 390 : 310;

        if (e.spearRetreatTimer > 0 || d < desiredGap) {
            e.vx -= Math.cos(angle) * (closeEnemies >= 2 ? 1.05 : 0.82);
            e.vy -= Math.sin(angle) * (closeEnemies >= 2 ? 1.05 : 0.82);

            const side = Math.sin((frameCount || 0) * 0.085 + e.id * 7) > 0 ? 1 : -1;
            e.vx += Math.cos(angle + Math.PI / 2 * side) * 0.36;
            e.vy += Math.sin(angle + Math.PI / 2 * side) * 0.36;
        } else if (d > 610) {
            e.vx += Math.cos(angle) * 0.44;
            e.vy += Math.sin(angle) * 0.44;
        } else {
            const side = Math.sin((frameCount || 0) * 0.045 + e.id * 11) > 0 ? 1 : -1;
            e.vx += Math.cos(angle + Math.PI / 2 * side) * 0.25;
            e.vy += Math.sin(angle + Math.PI / 2 * side) * 0.25;
        }

        fpAvoidEdges(e, 78, 1.05);

        if (projectileEvaded && Math.random() < 0.35) {
            e.spearCooldown = Math.min(e.spearCooldown || 0, 12);
        }

        if (e.spearCooldown <= 0 && d < 780) {
            const kind = chooseEliteSpearKind(e, target);

            if (kind === 'bounce' || safeHasLineOfSight(e, target)) {
                throwSpearProjectile(e, target, kind);
                e.spearCooldown = kind === 'normal' ? 24 : (kind === 'bounce' ? 48 : 56);
            }
        }

        return true;
    };

    function spawnSpiderWeb(spider, target, kind = 'pull') {
        if (!spider || !target) return false;

        const lead = kind === 'pin' ? 10 : 18;
        const aimX = target.x + (target.vx || 0) * lead;
        const aimY = target.y + (target.vy || 0) * lead;
        const angle = Math.atan2(aimY - spider.y, aimX - spider.x);
        const speed = kind === 'pin' ? 12.5 : 13.5;

        spider.angle = angle;

        projectiles.push({
            x: spider.x + Math.cos(angle) * ((spider.radius || 20) + 14),
            y: spider.y + Math.sin(angle) * ((spider.radius || 20) + 14),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            team: spider.team,
            life: 70,
            type: 'spider_web',
            isSpiderWeb: true,
            webKind: kind,
            shooterId: spider.id,
            radius: 9,
            trail: []
        });

        spawnParticles(spider.x + Math.cos(angle) * 18, spider.y + Math.sin(angle) * 18, '#dfe6e9', 6);
        spawnDamageText(spider.x, spider.y - 28, kind === 'pin' ? 'PIN WEB' : 'PULL WEB', '#8e44ad');
        if (typeof playSound === 'function') playSound('shot', 0.35);
        return true;
    }

    function applySpiderWebHit(web, target, spider) {
        if (!web || !target || target.hp <= 0) return false;

        web.dead = true;

        target.webbedBy = spider ? spider.id : web.shooterId;
        target.webTimer = web.webKind === 'pin' ? 115 : 92;
        target.webKind = web.webKind;
        target.webPullStrength = web.webKind === 'pull' ? 1.0 : 0;
        target.frozen = Math.max(target.frozen || 0, web.webKind === 'pin' ? 35 : 0);

        if (web.webKind === 'pin') {
            target.vx *= 0.1;
            target.vy *= 0.1;
            damageEntity(target, 7, web.x, web.y, spider || null);
            spawnDamageText(target.x, target.y - 28, 'WEB PIN', '#8e44ad', true);
        } else {
            const pullAngle = fpAngle(target, spider || web);
            target.vx += Math.cos(pullAngle) * 10.5;
            target.vy += Math.sin(pullAngle) * 10.5;
            target.frozen = 0;
            damageEntity(target, 5, web.x, web.y, spider || null);
            spawnDamageText(target.x, target.y - 28, 'WEB PULL', '#8e44ad', true);
        }

        spawnParticles(target.x, target.y, '#dfe6e9', 12);
        if (typeof playSound === 'function') playSound('trap', 0.35);
        return true;
    }

    function updateSpiderWebbedTargets() {
        entities.forEach(ent => {
            if (!ent || !ent.webTimer || ent.webTimer <= 0) return;

            ent.webTimer--;

            const spider = entities.find(s => s && s.id === ent.webbedBy && s.hp > 0);

            if (spider && ent.webKind === 'pull') {
                // Pull webs should drag the target, not freeze them in place.
                ent.frozen = 0;
                const angle = fpAngle(ent, spider);
                const d = fpDist(ent, spider);
                const pull = Math.max(0.55, Math.min(1.85, d / 155));
                ent.vx += Math.cos(angle) * pull;
                ent.vy += Math.sin(angle) * pull;

                // Direct tether tug keeps it visible/obvious even with friction and collisions.
                ent.x += Math.cos(angle) * 0.85;
                ent.y += Math.sin(angle) * 0.85;
            } else {
                ent.frozen = Math.max(ent.frozen || 0, 3);
                ent.vx *= 0.55;
                ent.vy *= 0.55;
            }

            if ((frameCount || 0) % 16 === 0) {
                const source = spider || null;
                damageEntity(ent, ent.webKind === 'pin' ? 1.4 : 0.8, ent.x, ent.y, source);
                spawnParticles(ent.x, ent.y, '#dfe6e9', 2);
            }

            if (ent.webTimer <= 0 || !spider) {
                ent.webTimer = 0;
                ent.webbedBy = null;
                ent.webKind = null;
                spawnParticles(ent.x, ent.y, '#dfe6e9', 5);
            }
        });
    }

    function spiderHeavyStrike(spider, target) {
        if (!spider || !target || target.hp <= 0) return false;

        const angle = fpAngle(spider, target);
        spider.angle = angle;

        damageEntity(target, target.webTimer > 0 ? 27 : 21, target.x, target.y, spider);
        target.vx += Math.cos(angle) * 9.5;
        target.vy += Math.sin(angle) * 9.5;
        spider.vx -= Math.cos(angle) * 2.5;
        spider.vy -= Math.sin(angle) * 2.5;

        spider.spiderStrikeCooldown = 52;
        spider.spiderTelegraphTimer = 0;
        spider.spiderTelegraphTargetId = null;

        spawnParticles(target.x, target.y, '#111111', 12);
        spawnDamageText(target.x, target.y - 34, 'VENOM SLAM', '#8e44ad', true);
        if (typeof playSound === 'function') playSound('heavy_hit', 0.55);

        return true;
    }

    function handleSpiderAI(spider) {
        if (!spider || spider.type !== 'spider' || spider.hp <= 0 || isSetupPhase || spider.isDancing) return false;

        if (spider.webCooldown === undefined) spider.webCooldown = 20;
        if (spider.spiderStrikeCooldown === undefined) spider.spiderStrikeCooldown = 0;
        if (spider.spiderDodgeCooldown === undefined) spider.spiderDodgeCooldown = 0;
        if (spider.spiderTelegraphTimer === undefined) spider.spiderTelegraphTimer = 0;

        if (spider.webCooldown > 0) spider.webCooldown--;
        if (spider.spiderStrikeCooldown > 0) spider.spiderStrikeCooldown--;
        if (spider.spiderDodgeCooldown > 0) spider.spiderDodgeCooldown--;
        if (spider.blockCooldown > 0) spider.blockCooldown--;

        if (spider.isBlocking) {
            spider.blockTimer--;
            spider.vx *= 0.84;
            spider.vy *= 0.84;
            if (spider.blockTimer <= 0) {
                spider.isBlocking = false;
                spider.blockCooldown = 45;
            }
            return true;
        }

        const incoming = fpIncomingProjectiles(spider, 175);
        if (incoming.length > 0) {
            const d = fpDist(spider, incoming[0]);

            if (spider.spiderDodgeCooldown <= 0 && d < 155) {
                fpEvadeProjectiles(spider, 185, 1.28);
                spider.spiderDodgeCooldown = 18;
                spawnDamageText(spider.x, spider.y - 30, 'SPIDER DODGE', '#8e44ad');
                return true;
            }

            if (d < 95 && (spider.blockCooldown || 0) <= 0) {
                spider.angle = Math.atan2(incoming[0].y - spider.y, incoming[0].x - spider.x);
                spider.isBlocking = true;
                spider.blockTimer = 24;
                spawnDamageText(spider.x, spider.y - 30, 'WEB GUARD', '#dfe6e9');
                return true;
            }
        }

        const target = fpClosestEnemy(spider, 680);
        if (!target) return true;

        spider.target = target;
        const d = fpDist(spider, target);
        const angle = fpAngle(spider, target);
        spider.angle = angle;

        if (spider.spiderTelegraphTimer > 0) {
            spider.spiderTelegraphTimer--;
            spider.vx *= 0.72;
            spider.vy *= 0.72;

            const lockedTarget = entities.find(e => e && e.id === spider.spiderTelegraphTargetId && e.hp > 0) || target;
            spider.angle = fpAngle(spider, lockedTarget);
            spawnParticles(spider.x + Math.cos(spider.angle) * (spider.radius + 10), spider.y + Math.sin(spider.angle) * (spider.radius + 10), '#8e44ad', 1);

            if (spider.spiderTelegraphTimer <= 0 && fpDist(spider, lockedTarget) < 92) {
                spiderHeavyStrike(spider, lockedTarget);
            }

            return true;
        }

        if (spider.webCooldown <= 0 && d < 440 && safeHasLineOfSight(spider, target)) {
            const kind = (d > 190 || target.vx * target.vx + target.vy * target.vy > 18) ? 'pull' : 'pin';
            spawnSpiderWeb(spider, target, kind);
            spider.webCooldown = kind === 'pin' ? 95 : 72;
        }

        if (d < 88 && spider.spiderStrikeCooldown <= 0) {
            spider.spiderTelegraphTimer = 16;
            spider.spiderTelegraphTargetId = target.id;
            spawnDamageText(spider.x, spider.y - 30, 'TELEGRAPH', '#8e44ad', true);
            return true;
        }

        if (d > 245) {
            spider.vx += Math.cos(angle) * 0.58;
            spider.vy += Math.sin(angle) * 0.58;
        } else if (d < 128) {
            spider.vx -= Math.cos(angle) * 0.46;
            spider.vy -= Math.sin(angle) * 0.46;
        } else {
            const side = Math.sin((frameCount || 0) * 0.055 + spider.id * 6) > 0 ? 1 : -1;
            spider.vx += Math.cos(angle + Math.PI / 2 * side) * 0.35;
            spider.vy += Math.sin(angle + Math.PI / 2 * side) * 0.35;
        }

        fpAvoidEdges(spider, 55, 0.75);

        return true;
    }

    function bombmanSmash(bombman, target) {
        if (!bombman || !target || target.hp <= 0) return false;

        const angle = fpAngle(bombman, target);
        bombman.angle = angle;

        const damage =
            target.type === 'unarmed' ? 165 :
            target.type === 'spider' ? 85 :
            target.type === 'bombman' ? 48 :
            70;

        damageEntity(target, damage, target.x, target.y, bombman);
        target.vx += Math.cos(angle) * 16;
        target.vy += Math.sin(angle) * 16;

        bombman.bombPunchCooldown = 34;
        bombman.bombShockwaveCooldown = Math.max(bombman.bombShockwaveCooldown || 0, 16);

        spawnParticles(target.x, target.y, '#ff4757', 24);
        spawnParticles(target.x, target.y, '#2d3436', 12);
        spawnDamageText(target.x, target.y - 42, target.type === 'unarmed' ? 'ONE SHOT' : 'BOMB PUNCH', '#ff4757', true);
        registerBigMoment(target.x, target.y, 'BOMB PUNCH', 'boom');
        triggerSlowMoBigHit(20);
        if (typeof playSound === 'function') playSound('explosion_small', 0.8);

        return true;
    }

    function bombmanBreakObjects(bombman) {
        if (!bombman || typeof obstacles === 'undefined') return;

        obstacles.forEach(o => {
            if (!o || o.hp <= 0) return;
            const d = fpDist(bombman, o);
            if (d < (bombman.radius || 24) + (o.radius || 20) + 34) {
                if (o.type === 'rock' || o.type === 'barrel') {
                    o.hp = 0;
                    spawnParticles(o.x, o.y, o.type === 'barrel' ? '#ff7675' : '#636e72', 18);
                    spawnDamageText(o.x, o.y - 24, o.type === 'rock' ? 'ROCK BROKE' : 'BARREL BROKE', '#ff4757', true);
                    if (o.type === 'barrel') triggerExplosion(o.x, o.y, 120, 42, bombman.id);
                } else {
                    o.hp -= 18;
                }
            }
        });
    }

    function fpFindDuplicatorOriginalTarget(bombman) {
        if (!bombman || typeof entities === 'undefined') return null;

        // If Bombman sees a duplicator swarm, he knows to kill the real/original body first.
        const originals = entities
            .filter(e =>
                e &&
                e.hp > 0 &&
                e.team !== bombman.team &&
                e.type === 'duplicator' &&
                (e.isOriginal || e.isKing || !e.parentId)
            )
            .sort((a, b) => fpDist(bombman, a) - fpDist(bombman, b));

        if (originals.length > 0) return originals[0];

        const clone = entities.find(e =>
            e &&
            e.hp > 0 &&
            e.team !== bombman.team &&
            e.type === 'duplicator' &&
            e.parentId
        );

        if (clone) {
            const parent = entities.find(e => e && e.hp > 0 && e.id === clone.parentId);
            if (parent) return parent;
        }

        return null;
    }

    function handleBombmanAI(bombman) {
        if (!bombman || bombman.type !== 'bombman' || bombman.hp <= 0 || isSetupPhase || bombman.isDancing) return false;

        bombman.isBlocking = false;
        bombman.blockTimer = 0;

        if (bombman.bombPunchCooldown === undefined) bombman.bombPunchCooldown = 0;
        if (bombman.bombShockwaveCooldown === undefined) bombman.bombShockwaveCooldown = 0;

        if (bombman.bombPunchCooldown > 0) bombman.bombPunchCooldown--;
        if (bombman.bombShockwaveCooldown > 0) bombman.bombShockwaveCooldown--;

        const target = fpFindDuplicatorOriginalTarget(bombman) || fpClosestEnemy(bombman, 9999);
        if (!target) return true;

        bombman.target = target;
        const d = fpDist(bombman, target);
        const angle = fpAngle(bombman, target);
        bombman.angle = angle;

        // Bombman is faster than most but heavy: decisive forward pressure.
        bombman.vx += Math.cos(angle) * 0.62;
        bombman.vy += Math.sin(angle) * 0.62;

        if (d < (bombman.radius || 24) + (target.radius || 20) + 28 && bombman.bombPunchCooldown <= 0) {
            bombmanSmash(bombman, target);
        }

        if (bombman.bombShockwaveCooldown <= 0 && d < 95) {
            fpEnemyCandidates(bombman, true).forEach(enemy => {
                const ed = fpDist(bombman, enemy);
                if (ed < 95) {
                    const ea = fpAngle(bombman, enemy);
                    damageEntity(enemy, enemy.type === 'unarmed' ? 40 : 18, enemy.x, enemy.y, bombman);
                    enemy.vx += Math.cos(ea) * 7;
                    enemy.vy += Math.sin(ea) * 7;
                }
            });

            bombman.bombShockwaveCooldown = 62;
            spawnParticles(bombman.x, bombman.y, '#ff4757', 18);
            if (typeof playSound === 'function') playSound('explosion_small', 0.55);
        }

        bombmanBreakObjects(bombman);
        fpAvoidEdges(bombman, 42, 0.52);
        return true;
    }

    function spawnHomingMissile(missileFighter, target) {
        if (!missileFighter || !target) return false;

        const angle = fpAngle(missileFighter, target);
        const speed = 7.8;

        missileFighter.angle = angle;

        projectiles.push({
            x: missileFighter.x + Math.cos(angle) * ((missileFighter.radius || 20) + 18),
            y: missileFighter.y + Math.sin(angle) * ((missileFighter.radius || 20) + 18),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            team: missileFighter.team,
            life: 250,
            type: 'cannonball',
            isHomingMissile: true,
            targetId: target.id,
            shooterId: missileFighter.id,
            radius: 13,
            trail: [],
            missileTurnRate: 0.085
        });

        spawnMuzzleFlash(missileFighter, angle, 'cannon');
        spawnDamageText(missileFighter.x, missileFighter.y - 28, 'MISSILE', '#ffa502', true);
        if (typeof playSound === 'function') playSound('cannon', 0.45);

        return true;
    }

    function updateHomingMissilesPre() {
        if (typeof projectiles === 'undefined') return;

        projectiles.forEach(p => {
            if (!p || p.dead || !p.isHomingMissile) return;

            if (!p.trail) p.trail = [];
            p.trail.unshift({ x: p.x, y: p.y });
            if (p.trail.length > 16) p.trail.pop();

            let target = p.targetId ? entities.find(e => e && e.id === p.targetId && e.hp > 0) : null;

            if (!target) {
                target = entities
                    .filter(e => e && e.team !== p.team && e.hp > 0 && e.type !== 'turret' && e.type !== 'boid' && e.type !== 'mammoth_mount')
                    .sort((a, b) => fpDist(p, a) - fpDist(p, b))[0];

                if (target) p.targetId = target.id;
            }

            if (!target) return;

            const desired = fpAngle(p, target);
            const current = Math.atan2(p.vy || 0, p.vx || 0);
            let diff = desired - current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const turn = p.missileTurnRate || 0.085;
            const nextAngle = current + fpClamp(diff, -turn, turn);
            const speed = Math.min(12.2, Math.max(7.8, Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2) + 0.025));

            p.vx = Math.cos(nextAngle) * speed;
            p.vy = Math.sin(nextAngle) * speed;
        });
    }

    function handleMissileAI(missileFighter) {
        if (!missileFighter || missileFighter.type !== 'missile' || missileFighter.hp <= 0 || isSetupPhase || missileFighter.isDancing) return false;

        if (missileFighter.missileCooldown === undefined) missileFighter.missileCooldown = 20;
        if (missileFighter.missileBurstLeft === undefined) missileFighter.missileBurstLeft = 0;
        if (missileFighter.missileBurstGap === undefined) missileFighter.missileBurstGap = 0;

        if (missileFighter.missileCooldown > 0) missileFighter.missileCooldown--;
        if (missileFighter.missileBurstGap > 0) missileFighter.missileBurstGap--;

        fpEvadeProjectiles(missileFighter, 160, 0.65);

        const target = fpClosestEnemy(missileFighter, 820);
        if (!target) return true;

        missileFighter.target = target;
        const d = fpDist(missileFighter, target);
        const angle = fpAngle(missileFighter, target);
        missileFighter.angle = angle;

        if (d < 260) {
            missileFighter.vx -= Math.cos(angle) * 0.62;
            missileFighter.vy -= Math.sin(angle) * 0.62;
        } else if (d > 610) {
            missileFighter.vx += Math.cos(angle) * 0.36;
            missileFighter.vy += Math.sin(angle) * 0.36;
        } else {
            const side = Math.sin((frameCount || 0) * 0.048 + missileFighter.id * 5) > 0 ? 1 : -1;
            missileFighter.vx += Math.cos(angle + Math.PI / 2 * side) * 0.22;
            missileFighter.vy += Math.sin(angle + Math.PI / 2 * side) * 0.22;
        }

        fpAvoidEdges(missileFighter, 62, 0.82);

        const activeOwnedMissiles = projectiles.filter(p =>
            p &&
            !p.dead &&
            p.isHomingMissile &&
            p.shooterId === missileFighter.id
        ).length;

        if (missileFighter.missileCooldown <= 0 && activeOwnedMissiles < 3 && d < 800) {
            missileFighter.missileBurstLeft = Math.min(3 - activeOwnedMissiles, 3);
            missileFighter.missileCooldown = 150;
            missileFighter.missileBurstGap = 0;
        }

        if (missileFighter.missileBurstLeft > 0 && missileFighter.missileBurstGap <= 0) {
            if (spawnHomingMissile(missileFighter, target)) {
                missileFighter.missileBurstLeft--;
                missileFighter.missileBurstGap = 16;
            }
        }

        return true;
    }

    function updateSpiderWebProjectilesPre() {
        if (typeof projectiles === 'undefined') return;

        projectiles.forEach(p => {
            if (!p || p.dead || !p.isSpiderWeb) return;

            if (!p.trail) p.trail = [];
            p.trail.unshift({ x: p.x, y: p.y });
            if (p.trail.length > 12) p.trail.pop();

            const spider = entities.find(e => e && e.id === p.shooterId && e.hp > 0);
            const targets = fpEnemyCandidates({ team: p.team, id: -1, x: p.x, y: p.y }, true)
                .filter(e => fpDist(p, e) < (e.radius || 20) + (p.radius || 9) + 2);

            if (targets.length > 0) {
                applySpiderWebHit(p, targets[0], spider || null);
            }
        });
    }

    function drawFarrelPowerOverlays() {
        if (typeof ctx === 'undefined') return;

        ctx.save();

        // Webbed connection lines.
        entities.forEach(ent => {
            if (!ent || !ent.webTimer || ent.webTimer <= 0) return;

            const spider = entities.find(s => s && s.id === ent.webbedBy && s.hp > 0);
            ctx.strokeStyle = 'rgba(223, 230, 233, 0.72)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();

            if (spider) {
                ctx.moveTo(spider.x, spider.y);
                ctx.lineTo(ent.x, ent.y);
            } else {
                ctx.arc(ent.x, ent.y, (ent.radius || 20) + 14, 0, Math.PI * 2);
            }

            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Spider webs and missile trails/projectile bodies.
        projectiles.forEach(p => {
            if (!p || p.dead) return;

            if (p.isSpiderWeb) {
                if (p.trail && p.trail.length > 1) {
                    ctx.strokeStyle = 'rgba(223,230,233,0.65)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    p.trail.forEach(t => ctx.lineTo(t.x, t.y));
                    ctx.stroke();
                }

                ctx.fillStyle = '#dfe6e9';
                ctx.strokeStyle = '#8e44ad';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 6 + Math.sin((frameCount || 0) * 0.25) * 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            if (p.isHomingMissile) {
                if (p.trail && p.trail.length > 1) {
                    ctx.strokeStyle = 'rgba(255, 165, 2, 0.42)';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    p.trail.forEach(t => ctx.lineTo(t.x, t.y));
                    ctx.stroke();
                }

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(Math.atan2(p.vy || 0, p.vx || 0));
                ctx.fillStyle = '#34495e';
                ctx.strokeStyle = '#111';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(14, 0);
                ctx.lineTo(-10, -7);
                ctx.lineTo(-7, 0);
                ctx.lineTo(-10, 7);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.moveTo(-10, -5);
                ctx.lineTo(-20, 0);
                ctx.lineTo(-10, 5);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        });

        // Fighter-specific readable battlefield accessories.
        entities.forEach(e => {
            if (!e || e.hp <= 0) return;
            if (!NEW_FIGHTER_KEYS.concat(['spearer']).includes(e.type)) return;

            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(e.angle || 0);

            if (e.type === 'spider') {
                const r = e.radius || 20;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Eight readable legs, angled around the body.
                ctx.strokeStyle = '#111';
                ctx.lineWidth = 4;
                const legPairs = [
                    [-7, -13, -31, -31, -45, -25],
                    [ 4, -12,  28, -30,  43, -22],
                    [-10, -4, -36, -10, -48,   3],
                    [ 10, -4,  36, -10,  48,   3],
                    [-10,  5, -35,  13, -45,  28],
                    [ 10,  5,  35,  13,  45,  28],
                    [ -5, 13, -22,  34, -16,  48],
                    [  5, 13,  22,  34,  16,  48]
                ];

                legPairs.forEach(points => {
                    ctx.beginPath();
                    ctx.moveTo(points[0], points[1]);
                    ctx.lineTo(points[2], points[3]);
                    ctx.lineTo(points[4], points[5]);
                    ctx.stroke();
                });

                // Main body shine and web-sense ring.
                ctx.fillStyle = 'rgba(142, 68, 173, 0.28)';
                ctx.beginPath();
                ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = e.isBlocking ? '#dfe6e9' : '#8e44ad';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, r + 8, -0.9, 0.9);
                ctx.stroke();

                // Eyes.
                ctx.fillStyle = '#f5f6fa';
                ctx.beginPath();
                ctx.arc(8, -5, 3.5, 0, Math.PI * 2);
                ctx.arc(8, 5, 3.5, 0, Math.PI * 2);
                ctx.fill();

                if ((e.spiderTelegraphTimer || 0) > 0) {
                    ctx.strokeStyle = '#ff7675';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(r + 46, 0);
                    ctx.stroke();

                    ctx.strokeStyle = 'rgba(255, 118, 117, 0.35)';
                    ctx.lineWidth = 12;
                    ctx.beginPath();
                    ctx.moveTo(r, 0);
                    ctx.lineTo(r + 52, 0);
                    ctx.stroke();
                }
            }

            if (e.type === 'bombman') {
                ctx.strokeStyle = '#ff4757';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 0, (e.radius || 24) + 7 + Math.sin((frameCount || 0) * 0.22) * 2, 0, Math.PI * 2);
                ctx.stroke();

                ctx.strokeStyle = '#2d3436';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(-5, -(e.radius || 24) - 3);
                ctx.quadraticCurveTo(0, -(e.radius || 24) - 22, 12, -(e.radius || 24) - 18);
                ctx.stroke();

                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.arc(16, -(e.radius || 24) - 18, 5, 0, Math.PI * 2);
                ctx.fill();
            }

            if (e.type === 'missile') {
                ctx.fillStyle = '#2d3436';
                ctx.strokeStyle = '#111';
                ctx.lineWidth = 2;
                ctx.fillRect(8, -8, 38, 16);
                ctx.strokeRect(8, -8, 38, 16);

                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.arc(48, 0, 5, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#dfe6e9';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-5, -16);
                ctx.lineTo(5, -25);
                ctx.lineTo(15, -16);
                ctx.stroke();
            }

            if (e.type === 'spearer') {
                ctx.strokeStyle = '#f5f5dc';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, (e.radius || 20) + 11, -0.8, 0.8);
                ctx.stroke();
            }

            ctx.restore();
        });

        ctx.restore();
    }

    if (typeof applyAI === 'function' && !applyAI.__farrelPowerWrapped) {
        const previousApplyAI = applyAI;

        applyAI = function farrelPowerApplyAI(e) {
            if (handleSpearerAI(e)) return;
            if (handleSpiderAI(e)) return;
            if (handleBombmanAI(e)) return;
            if (handleMissileAI(e)) return;
            return previousApplyAI.apply(this, arguments);
        };

        applyAI.__farrelPowerWrapped = true;
    }

    if (typeof update === 'function' && !update.__farrelPowerWrapped) {
        const previousUpdate = update;

        update = function farrelPowerUpdate() {
            updateHomingMissilesPre();
            updateSpiderWebProjectilesPre();
            updateSpiderWebbedTargets();

            const result = previousUpdate.apply(this, arguments);

            updateSpiderWebProjectilesPre();
            updateSpiderWebbedTargets();
            return result;
        };

        update.__farrelPowerWrapped = true;
    }

    if (typeof draw === 'function' && !draw.__farrelPowerWrapped) {
        const previousDraw = draw;

        draw = function farrelPowerDraw() {
            const result = previousDraw.apply(this, arguments);

            // Draw Farrel overlays in WORLD SPACE, not screen space.
            // This fixes spider legs/webs and Bombman's fuse drifting away when the camera follows/zooms.
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(camera.zoom, camera.zoom);
            ctx.translate(-camera.x, -camera.y);
            drawFarrelPowerOverlays();
            ctx.restore();

            return result;
        };

        draw.__farrelPowerWrapped = true;
    }

    // Refresh modern dropdowns/previews after adding new options.
    window.addEventListener('DOMContentLoaded', () => {
        fpRegisterFighters();
        if (typeof updateSquadUI === 'function') {
            setTimeout(() => updateSquadUI(), 0);
        }
    });
})();




/* --- FARREL FINAL RUNTIME PATCH: reliable controls toggle + resizing --- */
(function farrelFinalRuntimePatch() {
    const controls = document.getElementById('controlsPanel');
    const toggleBtn = document.getElementById('toggleControlsBtn');
    const handle = document.getElementById('controlResizeHandle');

    if (toggleBtn && controls && !toggleBtn.__farrelFinalToggle) {
        toggleBtn.__farrelFinalToggle = true;
        window.controlsVisible = controls.style.display !== 'none';

        window.toggleControls = function farrelReliableToggleControls() {
            window.controlsVisible = !window.controlsVisible;

            if (window.controlsVisible) {
                controls.style.setProperty('display', 'flex', 'important');
                toggleBtn.innerHTML = 'Hide Controls &#9650;';
                toggleBtn.style.backgroundColor = '#555';
            } else {
                controls.style.setProperty('display', 'none', 'important');
                toggleBtn.innerHTML = 'Show Controls &#9660;';
                toggleBtn.style.backgroundColor = '#2d3436';
            }
        };
    }

    if (controls && handle && !handle.__farrelFinalResize) {
        handle.__farrelFinalResize = true;

        const setHeight = h => {
            const next = Math.max(92, Math.min(window.innerHeight * 0.72, Number(h) || 180));
            document.documentElement.style.setProperty('--control-panel-height', `${next}px`);
            try { localStorage.setItem('ballBattleControlPanelHeight', String(Math.round(next))); } catch (err) {}
        };

        try {
            const saved = Number(localStorage.getItem('ballBattleControlPanelHeight'));
            if (saved) setHeight(saved);
        } catch (err) {}

        const onMove = ev => {
            if (!document.body.classList.contains('is-resizing-controls')) return;
            const rect = controls.getBoundingClientRect();
            setHeight((ev.clientY || 0) - rect.top);
            ev.preventDefault();
        };

        const onUp = () => {
            document.body.classList.remove('is-resizing-controls');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        handle.addEventListener('pointerdown', ev => {
            document.body.classList.add('is-resizing-controls');
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            ev.preventDefault();
        });
    }
})();


/* --- FARREL SQUAD TAB NO-STACK + RESIZE HANDLE FLOW PATCH --- */
(function farrelSquadNoStackPatch() {
    function keepResizeHandleAsPanelFooter() {
        const panel = document.getElementById('controlsPanel');
        const handle = document.getElementById('controlResizeHandle');
        if (!panel || !handle) return;

        // Keep it as the last flex item so it sits after the current tab area, not absolutely over cards.
        if (handle.parentElement !== panel || panel.lastElementChild !== handle) {
            panel.appendChild(handle);
        }
    }

    function normalizeSquadCardsNoStack() {
        document.querySelectorAll('#row-2 .fighter-card').forEach(card => {
            const actions = card.querySelector('.fighter-card-actions');
            const top = card.querySelector('.fighter-card-top');
            const select = card.querySelector('.fighter-select-wrap');
            if (actions) {
                actions.querySelectorAll('button').forEach(btn => {
                    btn.style.position = 'static';
                    btn.style.transform = 'none';
                });
            }
            if (top) top.style.minHeight = '34px';
            if (select) select.style.position = 'relative';
        });
        keepResizeHandleAsPanelFooter();
    }

    if (typeof updateSquadUI === 'function' && !updateSquadUI.__farrelNoStackWrapped) {
        const oldUpdateSquadUI = updateSquadUI;
        updateSquadUI = function farrelNoStackUpdateSquadUI() {
            const result = oldUpdateSquadUI.apply(this, arguments);
            setTimeout(normalizeSquadCardsNoStack, 0);
            return result;
        };
        updateSquadUI.__farrelNoStackWrapped = true;
        window.updateSquadUI = updateSquadUI;
    }

    if (typeof showRow === 'function' && !showRow.__farrelNoStackWrapped) {
        const oldShowRow = showRow;
        showRow = function farrelNoStackShowRow() {
            const result = oldShowRow.apply(this, arguments);
            setTimeout(normalizeSquadCardsNoStack, 0);
            return result;
        };
        showRow.__farrelNoStackWrapped = true;
        window.showRow = showRow;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            keepResizeHandleAsPanelFooter();
            normalizeSquadCardsNoStack();
            setTimeout(normalizeSquadCardsNoStack, 250);
        });
    } else {
        keepResizeHandleAsPanelFooter();
        normalizeSquadCardsNoStack();
        setTimeout(normalizeSquadCardsNoStack, 250);
    }
})();


/* --- FARREL NO-STACK PATCH C: raise old too-small saved panel height once --- */
(function farrelReadableSquadPanelDefault() {
    const KEY = 'ballBattleControlPanelHeightV2';
    function applyReadableDefault() {
        const panel = document.getElementById('controlsPanel');
        if (!panel) return;
        let saved = 0;
        try { saved = Number(localStorage.getItem(KEY) || localStorage.getItem('ballBattleControlPanelHeight') || 0); } catch (err) { saved = 0; }
        if (!saved || saved <= 190) {
            const h = 230;
            document.documentElement.style.setProperty('--control-panel-height', `${h}px`);
            panel.dataset.controlHeight = String(h);
            try {
                localStorage.setItem(KEY, String(h));
                localStorage.setItem('ballBattleControlPanelHeight', String(h));
            } catch (err) {}
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyReadableDefault);
    else applyReadableDefault();
    setTimeout(applyReadableDefault, 150);
})();


/* --- FARREL LABEL NUMBERS + FUN RECAP + FISH LATCH CAMERA FIX PATCH --- */
(function farrelLabelsRecapFunPatch() {
    function statListWithIds() {
        return Object.entries(battleStats || {}).map(([id, stat]) => {
            const endFrame = stat.deathFrame === null || stat.deathFrame === undefined ? frameCount : stat.deathFrame;
            const spawn = stat.spawnFrame === undefined ? battleStartFrame || 0 : stat.spawnFrame;
            const aliveFrames = Math.max(0, endFrame - spawn);
            const shotsFired = stat.shotsFired || 0;
            const shotsHit = stat.shotsHit || 0;

            return {
                ...stat,
                id: stat.id || id,
                aliveFrames,
                accuracy: shotsFired > 0 ? shotsHit / shotsFired : null
            };
        });
    }

    function getBattleHeatInfo() {
        const stats = statListWithIds();
        const totalDamage = stats.reduce((sum, stat) => sum + (stat.damageDealt || 0), 0);
        const totalShots = stats.reduce((sum, stat) => sum + (stat.shotsFired || 0), 0);
        const fighters = Math.max(1, stats.length);
        const timeSeconds = Math.max(1, Math.round((frameCount - battleStartFrame) / 60));
        const damagePerFighter = totalDamage / fighters;
        const koRate = battleTotalKills / Math.max(1, timeSeconds / 30);
        const shotPressure = totalShots / fighters;

        const score = Math.round(
            Math.min(100,
                damagePerFighter * 0.16 +
                battleTotalKills * 5 +
                koRate * 12 +
                shotPressure * 0.65
            )
        );

        let label = 'Calm Skirmish';
        if (score >= 25) label = 'Heated Fight';
        if (score >= 50) label = 'Arena Chaos';
        if (score >= 75) label = 'Absolute Mayhem';
        if (score >= 92) label = 'Legendary Bloodbath';

        return { score, label, totalDamage, totalShots, fighters, timeSeconds };
    }

    function buildBattleHeatHTML() {
        const heat = getBattleHeatInfo();
        return `
            <div class="recap-card wide battle-heat-card">
                <span>Battle Heat</span>
                <b>${escapeHtml(heat.label)} — ${heat.score}/100</b>
                <div class="battle-heat-meter">
                    <div class="battle-heat-fill" style="width:${Math.max(3, heat.score)}%;"></div>
                </div>
            </div>
        `;
    }

    function buildDetailedFighterReportHTML() {
        const stats = statListWithIds()
            .sort((a, b) => {
                const scoreA = (a.kills || 0) * 120 + (a.damageDealt || 0) + (a.aliveFrames || 0) / 20 - (a.damageTaken || 0) * 0.12;
                const scoreB = (b.kills || 0) * 120 + (b.damageDealt || 0) + (b.aliveFrames || 0) / 20 - (b.damageTaken || 0) * 0.12;
                return scoreB - scoreA;
            });

        if (stats.length === 0) {
            return `<div id="detailedRecapPanel" class="detailed-recap-panel" style="display:none;"><em>No fighter data recorded.</em></div>`;
        }

        const rows = stats.map((stat, index) => {
            const accuracyText = stat.accuracy === null
                ? '—'
                : `${Math.round(stat.accuracy * 100)}%`;

            const status = stat.deathFrame === null || stat.deathFrame === undefined ? 'Survived' : 'KO';
            const role = escapeHtml(stat.type || '?');
            const name = escapeHtml(stat.name || stat.type || `Fighter ${index + 1}`);

            return `
                <div class="detailed-fighter-row">
                    <div class="detailed-rank">${index + 1}</div>
                    <div class="detailed-color-dot" style="background:${escapeHtml(stat.color || '#777')}"></div>
                    <div class="detailed-main">
                        <b>${name}</b>
                        <span>${role} · ${status} · Alive ${formatBattleTime(stat.aliveFrames || 0)}</span>
                    </div>
                    <div class="detailed-stat"><span>KO</span><b>${stat.kills || 0}</b></div>
                    <div class="detailed-stat"><span>DMG+</span><b>${Math.round(stat.damageDealt || 0)}</b></div>
                    <div class="detailed-stat"><span>DMG-</span><b>${Math.round(stat.damageTaken || 0)}</b></div>
                    <div class="detailed-stat"><span>ACC</span><b>${accuracyText}</b></div>
                </div>
            `;
        }).join('');

        return `
            <div id="detailedRecapPanel" class="detailed-recap-panel" style="display:none;">
                <div class="detailed-recap-title">Detailed Fighter Report</div>
                ${rows}
            </div>
        `;
    }

    window.toggleDetailedRecap = function toggleDetailedRecap() {
        const panel = document.getElementById('detailedRecapPanel');
        const btn = document.getElementById('detailedRecapBtn');
        if (!panel) return;

        const nextVisible = panel.style.display === 'none' || !panel.style.display;
        panel.style.display = nextVisible ? 'block' : 'none';

        if (btn) {
            btn.innerText = nextVisible ? 'Hide Fighter Report' : 'Show Fighter Report';
        }
    };

    window.copyBattleRecapSummary = function copyBattleRecapSummary() {
        const stats = statListWithIds();
        const heat = getBattleHeatInfo();

        const lines = [
            `Battle Recap — ${heat.label} (${heat.score}/100)`,
            `Total KOs: ${battleTotalKills}`,
            `Battle Time: ${formatBattleTime(frameCount - battleStartFrame)}`,
            '',
            ...stats
                .sort((a, b) => (b.damageDealt || 0) - (a.damageDealt || 0))
                .map(stat => {
                    const accuracy = stat.accuracy === null ? 'N/A' : `${Math.round(stat.accuracy * 100)}%`;
                    return `${stat.name}: ${stat.kills || 0} KO, ${Math.round(stat.damageDealt || 0)} dealt, ${Math.round(stat.damageTaken || 0)} taken, ${accuracy} accuracy, survived ${formatBattleTime(stat.aliveFrames || 0)}`;
                })
        ];

        const text = lines.join('\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => showCustomMessage('Battle Recap', 'Copied detailed recap to clipboard.'))
                .catch(() => showCustomMessage('Battle Recap', text.slice(0, 220) + '...'));
        } else {
            showCustomMessage('Battle Recap', text.slice(0, 220) + '...');
        }
    };

    if (typeof buildBattleRecapHTML === 'function' && !buildBattleRecapHTML.__farrelDetailedWrapped) {
        const originalBuildBattleRecapHTML = buildBattleRecapHTML;

        buildBattleRecapHTML = function farrelDetailedBuildBattleRecapHTML() {
            const baseHTML = originalBuildBattleRecapHTML.apply(this, arguments);
            const extraHTML = `
                <div class="recap-fun-row">
                    ${buildBattleHeatHTML()}
                    <div class="recap-action-row">
                        <button id="detailedRecapBtn" onclick="toggleDetailedRecap()">Show Fighter Report</button>
                        <button onclick="copyBattleRecapSummary()">Copy Recap</button>
                    </div>
                    ${buildDetailedFighterReportHTML()}
                </div>
            `;

            const insertIndex = baseHTML.lastIndexOf('</div>');
            if (insertIndex === -1) return baseHTML + extraHTML;
            return baseHTML.slice(0, insertIndex) + extraHTML + baseHTML.slice(insertIndex);
        };

        buildBattleRecapHTML.__farrelDetailedWrapped = true;
        window.buildBattleRecapHTML = buildBattleRecapHTML;
    }

    // Anchor latched fish with stable local offsets so camera zoom/tracking cannot make them float away.
    if (typeof updateAquamarineProjectiles === 'function' && !updateAquamarineProjectiles.__farrelLatchStableWrapped) {
        const previousUpdateAquamarineProjectiles = updateAquamarineProjectiles;

        updateAquamarineProjectiles = function farrelStableLatchedFishUpdate() {
            const result = previousUpdateAquamarineProjectiles.apply(this, arguments);

            if (!Array.isArray(projectiles) || !Array.isArray(entities)) return result;

            projectiles.forEach(p => {
                if (!p || p.dead || p.type !== 'fish' || !p.latchedTargetId) return;

                const target = entities.find(en => en && en.id === p.latchedTargetId && en.hp > 0);
                if (!target) return;

                if (p.latchLocalAngle === undefined) {
                    p.latchLocalAngle = Math.atan2(p.y - target.y, p.x - target.x) - (target.angle || 0);
                    p.latchDistance = clamp((target.radius || 20) * 0.78 + 5, 14, (target.radius || 20) + 8);
                }

                const worldAngle = (target.angle || 0) + p.latchLocalAngle + Math.sin(frameCount * 0.18 + (p.fishPhase || 0)) * 0.12;
                p.x = target.x + Math.cos(worldAngle) * p.latchDistance;
                p.y = target.y + Math.sin(worldAngle) * p.latchDistance;
                p.vx = target.vx || 0;
                p.vy = target.vy || 0;
            });

            return result;
        };

        updateAquamarineProjectiles.__farrelLatchStableWrapped = true;
        window.updateAquamarineProjectiles = updateAquamarineProjectiles;
    }
})();


/* --- FARREL MASS MAPS + UNIQUE FFA COLORS + FUN FEATURES PATCH --- */
(function farrelMassMapsColorsFunPatch() {
    const MASS_RENDER_LIMIT = 120;
    const MASS_MAP_SIZES = {
        small: { w: 400, h: 400 },
        normal: { w: 600, h: 500 },
        large: { w: 1200, h: 800 },
        huge: { w: 2000, h: 1500 },
        massive: { w: 3600, h: 2400 },
        mega: { w: 9000, h: 6000 }
    };

    let massSpawnCursor = { ffa: 0, p1: 0, p2: 0 };
    let farrelSuddenDeathEnabled = false;
    let farrelKOConfettiEnabled = false;
    let farrelShowdownEnabled = true;
    let suddenDeathAnnounced = false;

    function safeNum(value, fallback, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return clamp(Math.round(n), min, max);
    }

    function getDesiredCount(prefix) {
        const input = document.getElementById(prefix + 'Count');
        return safeNum(input ? input.value : 1, 1, 1, 10000);
    }

    function getDesiredTotalFighters() {
        const p1 = getDesiredCount('p1');
        const p2 = GAME_MODE === 'ffa' ? 0 : getDesiredCount('p2');
        return Math.max(1, p1 + p2);
    }

    function titleForType(type) {
        return typeof titleCaseName === 'function'
            ? titleCaseName(type)
            : String(type || 'unarmed').replace(/\b\w/g, c => c.toUpperCase());
    }

    function setCanvasMapSize(w, h, modeLabel = 'custom') {
        w = safeNum(w, 600, 300, 12000);
        h = safeNum(h, 500, 300, 9000);

        canvas.width = w;
        canvas.height = h;
        canvas.style.aspectRatio = `${w} / ${h}`;

        camera.x = w / 2;
        camera.y = h / 2;
        camera.zoom = Math.min(camera.zoom || 1, 1);

        const cw = document.getElementById('customMapWidth');
        const ch = document.getElementById('customMapHeight');
        if (cw) cw.value = w;
        if (ch) ch.value = h;

        try {
            localStorage.setItem('ballBattleMapSize', JSON.stringify({ w, h, modeLabel }));
        } catch (err) {}

        if (isSetupPhase && typeof initializeSquads === 'function') {
            initializeSquads();
        }

        if (typeof showCustomMessage === 'function') {
            showCustomMessage('Map Size', `${modeLabel.toUpperCase()} map: ${w} × ${h}`);
        }
    }

    window.applyCustomMapSize = function applyCustomMapSize() {
        if (!isSetupPhase) {
            showCustomMessage('Notice', 'Cannot change map size during battle. Hit RESET first.');
            return;
        }

        const w = document.getElementById('customMapWidth');
        const h = document.getElementById('customMapHeight');
        setCanvasMapSize(w ? w.value : 3000, h ? h.value : 2000, 'custom');
    };

    window.setMassBattlePreset = function setMassBattlePreset(count) {
        if (!isSetupPhase) {
            showCustomMessage('Notice', 'Reset before changing mass battle setup.');
            return;
        }

        const modeSelect = document.getElementById('modeSelect');
        if (modeSelect && modeSelect.value !== 'ffa') {
            modeSelect.value = 'ffa';
            if (typeof toggleGameMode === 'function') toggleGameMode();
        } else {
            GAME_MODE = 'ffa';
        }

        const p1 = document.getElementById('p1Count');
        if (p1) p1.value = String(count);

        const mapSelect = document.getElementById('mapSizeSelect');
        if (mapSelect) mapSelect.value = count >= 10000 ? 'mega' : 'massive';

        changeMapSize();
        if (typeof randomizeSquads === 'function') randomizeSquads('p1');
        if (typeof showCustomMessage === 'function') {
            showCustomMessage('Mass Battle', `${count} fighter FFA prepared with a matching map.`);
        }
    };

    function syncCustomMapControls() {
        const mapSelect = document.getElementById('mapSizeSelect');
        const controls = document.getElementById('customMapControls');
        if (!mapSelect || !controls) return;
        controls.style.display = mapSelect.value === 'custom' ? 'block' : 'none';
    }

    if (typeof changeMapSize === 'function') {
        changeMapSize = function farrelMassiveChangeMapSize() {
            if (!isSetupPhase) {
                showCustomMessage('Notice', 'Cannot change map size during battle. Hit RESET first.');
                return;
            }

            const mapSelect = document.getElementById('mapSizeSelect');
            const size = mapSelect ? mapSelect.value : 'normal';
            syncCustomMapControls();

            if (size === 'custom') {
                window.applyCustomMapSize();
                return;
            }

            const dims = MASS_MAP_SIZES[size] || MASS_MAP_SIZES.normal;
            setCanvasMapSize(dims.w, dims.h, size);
        };
        window.changeMapSize = changeMapSize;
    }

    function getUnlimitedFFAColor(index) {
        // Golden-angle hue + cycling saturation/lightness gives thousands of visibly separated colors.
        const i = Math.max(1, Number(index) || 1);
        const hue = (i * 137.50776405003785) % 360;
        const sat = 58 + ((i * 47) % 35);    // 58-92
        const light = 38 + ((i * 29) % 24);  // 38-61
        return `hsl(${hue.toFixed(3)}, ${sat}%, ${light}%)`;
    }

    function applyUniqueFFAColors() {
        if (GAME_MODE !== 'ffa' || !Array.isArray(entities)) return;

        const teamColor = new Map();
        const livingTeams = [...new Set(entities
            .filter(e => e && e.team !== 0)
            .map(e => e.team))]
            .sort((a, b) => Number(a) - Number(b));

        livingTeams.forEach((team, index) => {
            teamColor.set(team, getUnlimitedFFAColor(index + 1));
        });

        entities.forEach(e => {
            if (!e || e.team === 0) return;
            const c = teamColor.get(e.team);
            if (c) e.color = c;
        });

        Object.values(battleStats || {}).forEach(stat => {
            if (!stat || stat.team === undefined) return;
            const c = teamColor.get(stat.team);
            if (c) stat.color = c;
        });
    }

    function shouldUseMassGridSpawn() {
        return getDesiredTotalFighters() > 220 || canvas.width >= 3000 || canvas.height >= 2200;
    }

    function nextGridSpawn(side, myRadius = 20) {
        const total = Math.max(1, getDesiredTotalFighters());
        const padding = Math.max(60, myRadius + 25);
        const availableW = Math.max(100, canvas.width - padding * 2);
        const availableH = Math.max(100, canvas.height - padding * 2);
        const aspect = availableW / availableH;

        let areaMultiplier = GAME_MODE === 'ffa' ? 1 : 0.5;
        const effectiveTotal = GAME_MODE === 'ffa'
            ? total
            : Math.max(1, side === 1 ? getDesiredCount('p1') : getDesiredCount('p2'));

        let cols = Math.ceil(Math.sqrt(effectiveTotal * aspect * areaMultiplier));
        cols = Math.max(1, cols);
        const rows = Math.max(1, Math.ceil(effectiveTotal / cols));

        const cursorKey = GAME_MODE === 'ffa' ? 'ffa' : (side === 1 ? 'p1' : 'p2');
        const index = massSpawnCursor[cursorKey]++;
        const col = index % cols;
        const row = Math.floor(index / cols);

        const cellW = availableW * (GAME_MODE === 'ffa' ? 1 : 0.47) / cols;
        const cellH = availableH / rows;

        let xBase;
        if (GAME_MODE === 'ffa') {
            xBase = padding;
        } else if (side === 1) {
            xBase = padding;
        } else {
            xBase = canvas.width * 0.53;
        }

        const jitterX = (Math.random() - 0.5) * Math.min(cellW * 0.45, 26);
        const jitterY = (Math.random() - 0.5) * Math.min(cellH * 0.45, 26);

        return {
            x: clamp(xBase + col * cellW + cellW / 2 + jitterX, padding, canvas.width - padding),
            y: clamp(padding + row * cellH + cellH / 2 + jitterY, padding, canvas.height - padding)
        };
    }

    if (typeof getSafeSpawnPos === 'function' && !getSafeSpawnPos.__farrelMassGridWrapped) {
        const oldGetSafeSpawnPos = getSafeSpawnPos;
        getSafeSpawnPos = function farrelMassGridSafeSpawn(side, myRadius = 20) {
            if (shouldUseMassGridSpawn()) {
                return nextGridSpawn(side, myRadius);
            }
            return oldGetSafeSpawnPos.apply(this, arguments);
        };
        getSafeSpawnPos.__farrelMassGridWrapped = true;
        window.getSafeSpawnPos = getSafeSpawnPos;
    }

    if (typeof generateSelectors === 'function' && !generateSelectors.__farrelMassUIWrapped) {
        const oldGenerateSelectors = generateSelectors;
        generateSelectors = function farrelMassGenerateSelectors(containerId, count, prefix, previousTypes) {
            const actualCount = safeNum(count, 1, 0, 10000);
            const renderCount = Math.min(actualCount, MASS_RENDER_LIMIT);
            const result = oldGenerateSelectors.call(this, containerId, renderCount, prefix, previousTypes);

            const container = document.getElementById(containerId);
            if (container && actualCount > MASS_RENDER_LIMIT) {
                const subtitle = container.querySelector('.squad-modern-subtitle');
                if (subtitle) {
                    subtitle.innerText = `${actualCount} fighters · ${renderCount} editable templates`;
                }

                const note = document.createElement('div');
                note.className = 'mass-squad-note';
                note.innerHTML = `
                    Mass squad mode: showing ${renderCount} editable templates.
                    The remaining ${actualCount - renderCount} fighters spawn as repeated/randomized copies.
                `;
                const header = container.querySelector('.squad-modern-header');
                if (header && header.nextSibling) {
                    container.insertBefore(note, header.nextSibling);
                } else {
                    container.appendChild(note);
                }
            }

            return result;
        };
        generateSelectors.__farrelMassUIWrapped = true;
        window.generateSelectors = generateSelectors;
    }

    function getTemplateTypes(prefix) {
        const inputs = Array.from(document.querySelectorAll(`.${prefix}-input`));
        const types = inputs
            .map(input => normalizeFighterInputValue(input.value))
            .filter(Boolean);

        if (types.length > 0) return types;

        const usable = FIGHTER_OPTIONS.filter(type => type && type !== 'empty');
        return [usable[Math.floor(Math.random() * usable.length)] || 'unarmed'];
    }

    function spawnMassExtraFighter(prefix, index, nextTeam) {
        const side = prefix === 'p1' ? 1 : 2;
        const templates = getTemplateTypes(prefix);
        let type = templates[index % templates.length] || 'unarmed';

        // Make massive battles more varied when the user only edited a few templates.
        if (index >= templates.length && Math.random() < 0.28) {
            const usable = FIGHTER_OPTIONS.filter(t => t && t !== 'empty');
            type = usable[Math.floor(Math.random() * usable.length)] || type;
        }

        const team = GAME_MODE === 'ffa' ? nextTeam : side;
        const spawn = getSafeSpawnPos(side, 25);
        const fighter = createFighter(type, spawn.x, spawn.y, team, false, null, null, prefix, index);

        fighter.initialX = spawn.x;
        fighter.initialY = spawn.y;
        fighter.nameIndex = entities.filter(e => e && e.type !== 'turret' && e.type !== 'boid' && !e.parentId).length + 1;
        fighter.displayName = getPersistentBallName(prefix, index, type);

        entities.push(fighter);

        if (type === 'necromancer' && typeof spawnSkeleton === 'function') {
            spawnSkeleton(spawn.x + (side === 1 ? -30 : 30), spawn.y + 20, team, fighter.id);
            spawnSkeleton(spawn.x + (side === 1 ? -30 : 30), spawn.y - 20, team, fighter.id);
        }

        if (type === 'dualist') {
            const pet = createFighter('binder', spawn.x + (side === 1 ? -40 : 40), spawn.y, team, true, fighter.id);
            pet.ownerId = fighter.id;
            pet.color = fighter.color;
            entities.push(pet);
        }

        return fighter;
    }

    function addMassExtraFightersIfNeeded() {
        const desiredP1 = getDesiredCount('p1');
        const desiredP2 = GAME_MODE === 'ffa' ? 0 : getDesiredCount('p2');

        const existingP1 = entities.filter(e => e && e.spawnSide === 'p1' && e.type !== 'boid' && e.type !== 'turret' && !e.parentId).length;
        const existingP2 = entities.filter(e => e && e.spawnSide === 'p2' && e.type !== 'boid' && e.type !== 'turret' && !e.parentId).length;

        let nextTeam = Math.max(0, ...entities.map(e => Number(e.team) || 0)) + 1;

        for (let i = existingP1; i < desiredP1; i++) {
            spawnMassExtraFighter('p1', i, nextTeam++);
        }

        if (GAME_MODE !== 'ffa') {
            for (let i = existingP2; i < desiredP2; i++) {
                spawnMassExtraFighter('p2', i, nextTeam++);
            }
        }

        // Register extra fighters in recap stats.
        entities.forEach(e => {
            if (!e || e.type === 'turret' || e.type === 'boid' || e.parentId) return;
            if (!battleStats[e.id]) {
                battleStats[e.id] = {
                    id: e.id,
                    name: typeof getEntityName === 'function' ? getEntityName(e) : e.type,
                    type: e.type,
                    color: e.color || '#777',
                    kills: 0,
                    team: e.team,
                    damageDealt: 0,
                    damageTaken: 0,
                    shotsFired: 0,
                    shotsHit: 0,
                    spawnFrame: frameCount,
                    deathFrame: null
                };
            }
        });
    }

    if (typeof initializeSquads === 'function' && !initializeSquads.__farrelMassWrapped) {
        const oldInitializeSquads = initializeSquads;
        initializeSquads = function farrelMassInitializeSquads() {
            massSpawnCursor = { ffa: 0, p1: 0, p2: 0 };
            const result = oldInitializeSquads.apply(this, arguments);
            addMassExtraFightersIfNeeded();
            applyUniqueFFAColors();
            if (typeof updateLiveCounts === 'function') updateLiveCounts();
            return result;
        };
        initializeSquads.__farrelMassWrapped = true;
        window.initializeSquads = initializeSquads;
    }

    window.toggleSuddenDeathMode = function toggleSuddenDeathMode() {
        farrelSuddenDeathEnabled = !farrelSuddenDeathEnabled;
        const btn = document.getElementById('suddenDeathBtn');
        if (btn) {
            btn.innerText = farrelSuddenDeathEnabled ? 'Sudden Death: ON' : 'Sudden Death: OFF';
            btn.classList.toggle('active', farrelSuddenDeathEnabled);
        }
        suddenDeathAnnounced = false;
    };

    window.toggleKOConfetti = function toggleKOConfetti() {
        farrelKOConfettiEnabled = !farrelKOConfettiEnabled;
        const btn = document.getElementById('koConfettiBtn');
        if (btn) {
            btn.innerText = farrelKOConfettiEnabled ? 'KO Confetti: ON' : 'KO Confetti: OFF';
            btn.classList.toggle('active', farrelKOConfettiEnabled);
        }
    };

    window.toggleFinalShowdown = function toggleFinalShowdown() {
        farrelShowdownEnabled = !farrelShowdownEnabled;
        const btn = document.getElementById('showdownBtn');
        if (btn) {
            btn.innerText = farrelShowdownEnabled ? 'Showdown: ON' : 'Showdown: OFF';
            btn.classList.toggle('active', farrelShowdownEnabled);
        }
    };

    function spawnKOConfetti(x, y) {
        if (!farrelKOConfettiEnabled || !Array.isArray(particles)) return;
        const colors = ['#ff4757', '#ffa502', '#2ed573', '#00c3ff', '#a55eea', '#fff200'];
        for (let i = 0; i < 24; i++) {
            spawnParticles(
                x + (Math.random() - 0.5) * 28,
                y + (Math.random() - 0.5) * 28,
                colors[i % colors.length],
                1,
                i % 5 === 0 ? 'note' : 'dot'
            );
        }
    }

    if (typeof recordDeathForRecap === 'function' && !recordDeathForRecap.__farrelConfettiWrapped) {
        const oldRecordDeathForRecap = recordDeathForRecap;
        recordDeathForRecap = function farrelConfettiDeathRecap(victim) {
            const result = oldRecordDeathForRecap.apply(this, arguments);
            if (victim && victim.x !== undefined && victim.y !== undefined) {
                spawnKOConfetti(victim.x, victim.y);
            }
            return result;
        };
        recordDeathForRecap.__farrelConfettiWrapped = true;
        window.recordDeathForRecap = recordDeathForRecap;
    }

    function applySuddenDeathPressure() {
        if (!farrelSuddenDeathEnabled || isSetupPhase || gameOverTriggered) return;

        const elapsed = frameCount - (battleStartFrame || 0);
        const startAt = 60 * 90; // 90 seconds
        if (elapsed < startAt) return;

        if (!suddenDeathAnnounced) {
            suddenDeathAnnounced = true;
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            if (typeof spawnDamageText === 'function') spawnDamageText(cx, cy, 'SUDDEN DEATH', '#ff4757', true);
            if (typeof showCustomMessage === 'function') showCustomMessage('Sudden Death', 'Arena edges are now dangerous.');
        }

        const danger = Math.min(
            Math.min(canvas.width, canvas.height) * 0.34,
            55 + (elapsed - startAt) * 0.018
        );

        entities.forEach(e => {
            if (!e || e.hp <= 0 || e.type === 'turret' || e.type === 'boid' || e.type === 'mammoth_mount') return;

            const outside =
                e.x < danger ||
                e.y < danger ||
                e.x > canvas.width - danger ||
                e.y > canvas.height - danger;

            if (!outside) return;

            const dx = canvas.width / 2 - e.x;
            const dy = canvas.height / 2 - e.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));

            e.vx += (dx / dist) * 0.9;
            e.vy += (dy / dist) * 0.9;

            if (frameCount % 12 === 0) {
                damageEntity(e, 1.25, e.x, e.y, null);
                spawnParticles(e.x, e.y, '#ff4757', 2);
            }
        });
    }

    function applyFinalShowdownCamera() {
        if (!farrelShowdownEnabled || isSetupPhase || gameOverTriggered) return;
        if (camera.targetId) return;

        const living = entities.filter(e =>
            e &&
            e.hp > 0 &&
            e.type !== 'turret' &&
            e.type !== 'boid' &&
            e.type !== 'mammoth_mount' &&
            !e.parentId
        );

        if (living.length !== 2) return;

        const midX = (living[0].x + living[1].x) / 2;
        const midY = (living[0].y + living[1].y) / 2;
        const dist = Math.sqrt((living[0].x - living[1].x) ** 2 + (living[0].y - living[1].y) ** 2);
        const desiredZoom = clamp(1.9 - dist / 1600, 1.05, 2.25);

        camera.x += (midX - camera.x) * 0.045;
        camera.y += (midY - camera.y) * 0.045;
        camera.zoom += (desiredZoom - camera.zoom) * 0.035;

        if (frameCount % 180 === 0 && typeof spawnDamageText === 'function') {
            spawnDamageText(midX, midY - 60, 'FINAL SHOWDOWN', 'gold', true);
        }
    }

    if (typeof update === 'function' && !update.__farrelFunWrapped) {
        const oldUpdate = update;
        update = function farrelFunUpdate() {
            const result = oldUpdate.apply(this, arguments);
            applyUniqueFFAColors();
            applySuddenDeathPressure();
            applyFinalShowdownCamera();
            return result;
        };
        update.__farrelFunWrapped = true;
        window.update = update;
    }

    if (typeof draw === 'function' && !draw.__farrelFunWrapped) {
        const oldDraw = draw;
        draw = function farrelFunDraw() {
            const result = oldDraw.apply(this, arguments);

            // Screen-space sudden death indicator. It does not interfere with world/camera transforms.
            if (farrelSuddenDeathEnabled && !isSetupPhase && !gameOverTriggered && frameCount - (battleStartFrame || 0) >= 60 * 90) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                const pulse = 0.65 + Math.sin(frameCount * 0.12) * 0.25;
                ctx.globalAlpha = pulse;
                ctx.strokeStyle = '#ff4757';
                ctx.lineWidth = 8;
                ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
                ctx.globalAlpha = 1;
                ctx.font = 'bold 22px Impact, Arial Black, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ff4757';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 4;
                ctx.strokeText('SUDDEN DEATH', canvas.width / 2, 34);
                ctx.fillText('SUDDEN DEATH', canvas.width / 2, 34);
                ctx.restore();
            }

            return result;
        };
        draw.__farrelFunWrapped = true;
        window.draw = draw;
    }

    if (typeof randomizeCounts === 'function' && !randomizeCounts.__farrelMassWrapped) {
        const oldRandomizeCounts = randomizeCounts;
        randomizeCounts = function farrelMassRandomizeCounts() {
            const mapSize = document.getElementById('mapSizeSelect')?.value || '';
            if (mapSize === 'massive' || mapSize === 'mega') {
                const max = mapSize === 'mega' ? 500 : 80;
                const p1 = document.getElementById('p1Count');
                const p2 = document.getElementById('p2Count');
                if (p1) p1.value = String(1 + Math.floor(Math.random() * max));
                if (p2 && GAME_MODE !== 'ffa') p2.value = String(1 + Math.floor(Math.random() * max));
                updateSquadUI();
                return;
            }
            return oldRandomizeCounts.apply(this, arguments);
        };
        randomizeCounts.__farrelMassWrapped = true;
        window.randomizeCounts = randomizeCounts;
    }

    function bootMassPatch() {
        syncCustomMapControls();

        const mapSelect = document.getElementById('mapSizeSelect');
        if (mapSelect && !mapSelect.__farrelMassListener) {
            mapSelect.addEventListener('change', syncCustomMapControls);
            mapSelect.__farrelMassListener = true;
        }

        document.querySelectorAll('#p1Count,#p2Count,#fsP1Count,#fsP2Count').forEach(input => {
            if (input) input.max = '10000';
        });

        const saved = localStorage.getItem('ballBattleMapSize');
        if (saved && isSetupPhase) {
            try {
                const data = JSON.parse(saved);
                if (data && data.w && data.h && canvas.width === 600 && canvas.height === 500) {
                    // Preserve the saved dimensions only after the user explicitly used custom/massive maps before.
                    if (data.modeLabel === 'custom' || data.modeLabel === 'massive' || data.modeLabel === 'mega') {
                        setCanvasMapSize(data.w, data.h, data.modeLabel);
                    }
                }
            } catch (err) {}
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootMassPatch);
    } else {
        bootMassPatch();
    }
})();

/* --- FARREL FUN FEATURES PACK 2 + KO CONFETTI DEFAULT OFF PATCH --- */
(function farrelFunFeaturesPackTwo() {
    let farrelRageModeEnabled = false;
    let farrelPowerDropsEnabled = false;
    let farrelRivalLinesEnabled = false;
    let farrelPowerDrops = [];
    let nextPowerDropFrame = 0;

    const POWER_DROP_TYPES = [
        { type: 'heal', label: 'HEAL', color: '#2ed573', icon: '+' },
        { type: 'speed', label: 'SPEED', color: '#00c3ff', icon: '»' },
        { type: 'damage', label: 'DAMAGE', color: '#ff4757', icon: '!' },
        { type: 'shield', label: 'SHIELD', color: '#f1c40f', icon: '◆' }
    ];

    function mainCombatFighters() {
        if (!Array.isArray(entities)) return [];
        return entities.filter(e =>
            e && e.hp > 0 &&
            e.type !== 'turret' &&
            e.type !== 'boid' &&
            e.type !== 'mammoth_mount' &&
            !e.parentId
        );
    }

    function safeDist(a, b) {
        if (!a || !b) return Infinity;
        return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
    }

    function findNearestEnemyForFeature(e) {
        let best = null;
        let bestD = Infinity;
        mainCombatFighters().forEach(other => {
            if (!other || other.id === e.id || other.team === e.team) return;
            const d = safeDist(e, other);
            if (d < bestD) {
                best = other;
                bestD = d;
            }
        });
        return best;
    }

    function worldToScreenPoint(x, y) {
        const z = camera && Number.isFinite(camera.zoom) ? camera.zoom : 1;
        return {
            x: (x - (camera?.x || 0)) * z + canvas.width / 2,
            y: (y - (camera?.y || 0)) * z + canvas.height / 2,
            z
        };
    }

    function isOnScreen(pt, margin = 90) {
        return pt.x > -margin && pt.y > -margin && pt.x < canvas.width + margin && pt.y < canvas.height + margin;
    }

    function setToggleButton(buttonId, enabled, onText, offText) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.innerText = enabled ? onText : offText;
        btn.classList.toggle('active', enabled);
    }

    window.toggleRageMode = function toggleRageMode() {
        farrelRageModeEnabled = !farrelRageModeEnabled;
        setToggleButton('rageModeBtn', farrelRageModeEnabled, 'Rage Mode: ON', 'Rage Mode: OFF');
        if (typeof showCustomMessage === 'function') {
            showCustomMessage('Rage Mode', farrelRageModeEnabled ? 'Low-HP fighters hit harder and surge forward.' : 'Rage Mode disabled.');
        }
    };

    window.togglePowerDrops = function togglePowerDrops() {
        farrelPowerDropsEnabled = !farrelPowerDropsEnabled;
        setToggleButton('powerDropsBtn', farrelPowerDropsEnabled, 'Power Drops: ON', 'Power Drops: OFF');
        if (!farrelPowerDropsEnabled) farrelPowerDrops = [];
        nextPowerDropFrame = frameCount + 240;
        if (typeof showCustomMessage === 'function') {
            showCustomMessage('Power Drops', farrelPowerDropsEnabled ? 'Boost orbs will spawn during battle.' : 'Power Drops disabled.');
        }
    };

    window.toggleRivalLines = function toggleRivalLines() {
        farrelRivalLinesEnabled = !farrelRivalLinesEnabled;
        setToggleButton('rivalLinesBtn', farrelRivalLinesEnabled, 'Rival Lines: ON', 'Rival Lines: OFF');
        if (typeof showCustomMessage === 'function') {
            showCustomMessage('Rival Lines', farrelRivalLinesEnabled ? 'The current main rivalry is highlighted.' : 'Rival Lines disabled.');
        }
    };

    function ensureKOConfettiStartsOff() {
        const btn = document.getElementById('koConfettiBtn');
        if (btn && btn.innerText.includes('ON')) {
            btn.innerText = 'KO Confetti: OFF';
            btn.classList.remove('active');
        }
    }

    function applyRageMode() {
        if (!farrelRageModeEnabled || isSetupPhase || gameOverTriggered) return;
        mainCombatFighters().forEach(e => {
            const ratio = (e.maxHp || 1) > 0 ? e.hp / e.maxHp : 1;
            const active = ratio > 0 && ratio <= 0.32;
            e.farrelRageActive = active;
            if (!active) return;

            const target = findNearestEnemyForFeature(e);
            if (target) {
                const angle = Math.atan2(target.y - e.y, target.x - e.x);
                e.vx += Math.cos(angle) * 0.055;
                e.vy += Math.sin(angle) * 0.055;
            }

            if (frameCount % 24 === 0 && typeof spawnParticles === 'function') {
                spawnParticles(e.x, e.y, '#ff4757', 2);
            }
        });
    }

    function spawnPowerDrop() {
        if (!farrelPowerDropsEnabled || isSetupPhase || gameOverTriggered) return;
        if (!Array.isArray(entities) || mainCombatFighters().length < 2) return;
        if (farrelPowerDrops.length >= 8) return;

        const margin = 70;
        const dropType = POWER_DROP_TYPES[Math.floor(Math.random() * POWER_DROP_TYPES.length)];
        farrelPowerDrops.push({
            ...dropType,
            id: `drop-${frameCount}-${Math.random().toString(16).slice(2)}`,
            x: margin + Math.random() * Math.max(10, canvas.width - margin * 2),
            y: margin + Math.random() * Math.max(10, canvas.height - margin * 2),
            radius: 17,
            life: 60 * 18,
            pulse: Math.random() * Math.PI * 2
        });
    }

    function applyPowerDropEffect(fighter, drop) {
        if (!fighter || !drop) return;
        const now = frameCount || 0;

        if (drop.type === 'heal') {
            fighter.hp = Math.min(fighter.maxHp || fighter.hp, fighter.hp + Math.max(14, (fighter.maxHp || 80) * 0.28));
            if (typeof spawnDamageText === 'function') spawnDamageText(fighter.x, fighter.y - 38, 'HEAL DROP', drop.color, true);
        }

        if (drop.type === 'speed') {
            fighter.farrelSpeedBoostUntil = now + 60 * 7;
            if (typeof spawnDamageText === 'function') spawnDamageText(fighter.x, fighter.y - 38, 'SPEED DROP', drop.color, true);
        }

        if (drop.type === 'damage') {
            fighter.farrelDamageBoostUntil = now + 60 * 7;
            if (typeof spawnDamageText === 'function') spawnDamageText(fighter.x, fighter.y - 38, 'DAMAGE DROP', drop.color, true);
        }

        if (drop.type === 'shield') {
            fighter.farrelShieldBoostUntil = now + 60 * 7;
            if (typeof spawnDamageText === 'function') spawnDamageText(fighter.x, fighter.y - 38, 'SHIELD DROP', drop.color, true);
        }

        if (typeof spawnParticles === 'function') spawnParticles(drop.x, drop.y, drop.color, 16);
        if (typeof playSound === 'function') playSound('equip', 0.5);
    }

    function updatePowerDrops() {
        if (!farrelPowerDropsEnabled || isSetupPhase || gameOverTriggered) return;

        if (!nextPowerDropFrame || frameCount >= nextPowerDropFrame) {
            spawnPowerDrop();
            nextPowerDropFrame = frameCount + 60 * (9 + Math.floor(Math.random() * 6));
        }

        const fighters = mainCombatFighters();
        farrelPowerDrops.forEach(drop => {
            drop.life--;
            fighters.forEach(f => {
                if (drop.dead) return;
                const hitDist = (f.radius || 20) + (drop.radius || 17);
                if (safeDist(f, drop) <= hitDist) {
                    applyPowerDropEffect(f, drop);
                    drop.dead = true;
                }
            });
        });

        farrelPowerDrops = farrelPowerDrops.filter(drop => !drop.dead && drop.life > 0);

        // Speed boosts gently help a fighter move toward the nearest enemy without overriding their AI.
        fighters.forEach(f => {
            if ((f.farrelSpeedBoostUntil || 0) <= frameCount) return;
            const target = findNearestEnemyForFeature(f);
            if (!target) return;
            const angle = Math.atan2(target.y - f.y, target.x - f.x);
            f.vx += Math.cos(angle) * 0.04;
            f.vy += Math.sin(angle) * 0.04;
        });
    }

    function getAliveByStatId(id) {
        return mainCombatFighters().find(e => String(e.id) === String(id)) || null;
    }

    function getRivalPair() {
        const stats = Object.values(battleStats || {});
        if (stats.length === 0) return null;

        const topDealer = stats
            .filter(stat => stat && (stat.damageDealt || 0) > 0)
            .sort((a, b) => (b.damageDealt || 0) - (a.damageDealt || 0))[0];

        if (!topDealer) return null;

        const a = getAliveByStatId(topDealer.id);
        if (!a) return null;

        let b = null;
        const enemies = mainCombatFighters().filter(e => e.team !== a.team && e.id !== a.id);
        if (enemies.length === 0) return null;

        // Prefer the enemy taking the most damage, then fall back to nearest enemy.
        const enemyStats = stats
            .filter(stat => enemies.some(e => String(e.id) === String(stat.id)))
            .sort((s1, s2) => (s2.damageTaken || 0) - (s1.damageTaken || 0));

        if (enemyStats[0]) b = getAliveByStatId(enemyStats[0].id);
        if (!b) {
            b = enemies.sort((e1, e2) => safeDist(a, e1) - safeDist(a, e2))[0];
        }

        return b ? { a, b } : null;
    }

    function drawPowerDrop(drop) {
        const pt = worldToScreenPoint(drop.x, drop.y);
        if (!isOnScreen(pt)) return;
        const r = Math.max(8, (drop.radius || 17) * pt.z);
        const pulse = 1 + Math.sin((frameCount || 0) * 0.14 + (drop.pulse || 0)) * 0.12;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.min(1, Math.max(0.25, drop.life / 60));
        ctx.shadowBlur = 12;
        ctx.shadowColor = drop.color;
        ctx.fillStyle = drop.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.font = `900 ${Math.max(12, r * 0.9)}px Segoe UI, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText(drop.icon, pt.x, pt.y);
        ctx.fillText(drop.icon, pt.x, pt.y);
        ctx.restore();
    }

    function drawRageAndBoostOverlays() {
        const fighters = mainCombatFighters();
        const now = frameCount || 0;

        fighters.forEach(e => {
            const activeRage = farrelRageModeEnabled && e.farrelRageActive;
            const speed = (e.farrelSpeedBoostUntil || 0) > now;
            const damage = (e.farrelDamageBoostUntil || 0) > now;
            const shield = (e.farrelShieldBoostUntil || 0) > now;
            if (!activeRage && !speed && !damage && !shield) return;

            const pt = worldToScreenPoint(e.x, e.y);
            if (!isOnScreen(pt)) return;
            const baseRadius = Math.max(10, ((e.radius || 20) + 8) * pt.z);

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.82;
            if (activeRage) {
                ctx.strokeStyle = '#ff4757';
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, baseRadius + Math.sin(now * 0.2) * 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (shield) {
                ctx.strokeStyle = '#f1c40f';
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, baseRadius + 6, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (speed || damage) {
                ctx.fillStyle = damage ? '#ff4757' : '#00c3ff';
                ctx.font = `900 ${Math.max(10, 12 * pt.z)}px Segoe UI, Arial`;
                ctx.textAlign = 'center';
                ctx.fillText(damage ? 'DMG' : 'SPD', pt.x, pt.y - baseRadius - 8);
            }
            ctx.restore();
        });
    }

    function drawRivalLines() {
        if (!farrelRivalLinesEnabled || isSetupPhase || gameOverTriggered) return;
        const pair = getRivalPair();
        if (!pair) return;
        const a = worldToScreenPoint(pair.a.x, pair.a.y);
        const b = worldToScreenPoint(pair.b.x, pair.b.y);
        if (!isOnScreen(a, 220) && !isOnScreen(b, 220)) return;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.72 + Math.sin((frameCount || 0) * 0.08) * 0.18;
        ctx.strokeStyle = '#ffbe76';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '900 12px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffbe76';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        const lx = (a.x + b.x) / 2;
        const ly = (a.y + b.y) / 2;
        ctx.strokeText('RIVALRY', lx, ly - 8);
        ctx.fillText('RIVALRY', lx, ly - 8);
        ctx.restore();
    }

    if (typeof damageEntity === 'function' && !damageEntity.__farrelFunPack2Wrapped) {
        const oldDamageEntity = damageEntity;
        damageEntity = function farrelFunPack2DamageEntity(victim, amount, impactX, impactY, source) {
            if (amount > 0) {
                if (source && source.hp > 0) {
                    if (farrelRageModeEnabled && source.farrelRageActive) amount *= 1.18;
                    if ((source.farrelDamageBoostUntil || 0) > (frameCount || 0)) amount *= 1.25;
                }

                if (victim && (victim.farrelShieldBoostUntil || 0) > (frameCount || 0)) {
                    amount *= 0.62;
                    if ((frameCount || 0) % 12 === 0 && typeof spawnDamageText === 'function') {
                        spawnDamageText(victim.x, victim.y - 35, 'SHIELD', '#f1c40f', true);
                    }
                }
            }
            return oldDamageEntity.call(this, victim, amount, impactX, impactY, source);
        };
        damageEntity.__farrelFunPack2Wrapped = true;
        window.damageEntity = damageEntity;
    }

    if (typeof resetPositions === 'function' && !resetPositions.__farrelFunPack2Wrapped) {
        const oldResetPositions = resetPositions;
        resetPositions = function farrelFunPack2ResetPositions() {
            farrelPowerDrops = [];
            nextPowerDropFrame = 0;
            return oldResetPositions.apply(this, arguments);
        };
        resetPositions.__farrelFunPack2Wrapped = true;
        window.resetPositions = resetPositions;
    }

    if (typeof beginBattle === 'function' && !beginBattle.__farrelFunPack2Wrapped) {
        const oldBeginBattle = beginBattle;
        beginBattle = function farrelFunPack2BeginBattle() {
            farrelPowerDrops = [];
            nextPowerDropFrame = frameCount + 240;
            return oldBeginBattle.apply(this, arguments);
        };
        beginBattle.__farrelFunPack2Wrapped = true;
        window.beginBattle = beginBattle;
    }

    if (typeof update === 'function' && !update.__farrelFunPack2Wrapped) {
        const oldUpdate = update;
        update = function farrelFunPack2Update() {
            const result = oldUpdate.apply(this, arguments);
            applyRageMode();
            updatePowerDrops();
            return result;
        };
        update.__farrelFunPack2Wrapped = true;
        window.update = update;
    }

    if (typeof draw === 'function' && !draw.__farrelFunPack2Wrapped) {
        const oldDraw = draw;
        draw = function farrelFunPack2Draw() {
            const result = oldDraw.apply(this, arguments);
            if (farrelPowerDropsEnabled) farrelPowerDrops.forEach(drawPowerDrop);
            drawRageAndBoostOverlays();
            drawRivalLines();
            return result;
        };
        draw.__farrelFunPack2Wrapped = true;
        window.draw = draw;
    }

    function bootFunPackTwo() {
        ensureKOConfettiStartsOff();
        setToggleButton('rageModeBtn', farrelRageModeEnabled, 'Rage Mode: ON', 'Rage Mode: OFF');
        setToggleButton('powerDropsBtn', farrelPowerDropsEnabled, 'Power Drops: ON', 'Power Drops: OFF');
        setToggleButton('rivalLinesBtn', farrelRivalLinesEnabled, 'Rival Lines: ON', 'Rival Lines: OFF');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFunPackTwo);
    } else {
        bootFunPackTwo();
    }
})();



// --- TOURNAMENT REVAMP + PET SIMULATOR REMOVAL PATCH ---
// Pet Simulator was an underdeveloped alternate ruleset. It is now removed from the UI so the main game stays clean.
// The old pet helper code is left dormant for save compatibility, but no selector exposes it anymore.
(function tournamentRevampAndPetRemovalPatch() {
    const TOURNEY_ROUND_NAMES_V2 = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];

    function safeGet(id) {
        return document.getElementById(id);
    }

    function removePetOptionsFromSelects() {
        document.querySelectorAll('option[value="pet"]').forEach(opt => opt.remove());

        const mainMode = safeGet('modeSelect');
        if (mainMode && mainMode.value === 'pet') mainMode.value = 'team';

        const fsMode = safeGet('fsModeSelect');
        if (fsMode && fsMode.value === 'pet') fsMode.value = 'team';
    }

    function getTournamentBracketSize() {
        const el = safeGet('tourneyBracketSize');
        const value = el ? parseInt(el.value, 10) : 16;
        return [8, 16, 32].includes(value) ? value : 16;
    }

    function getTournamentTeamSize() {
        const el = safeGet('tourneyTeamSize');
        return clamp(parseInt(el ? el.value : 5, 10) || 5, 1, 30);
    }

    function getTournamentRuleset() {
        const el = safeGet('tourneyRuleset');
        return el ? el.value : 'balanced';
    }

    function getTournamentSeedStyle() {
        const el = safeGet('tourneySeedStyle');
        return el ? el.value : 'shuffle';
    }

    function getTournamentRoundName(roundIndex, totalTeams) {
        const sizeAtRound = Math.max(1, totalTeams / Math.pow(2, roundIndex));
        if (sizeAtRound === 2) return 'Final';
        if (sizeAtRound === 4) return 'Semifinals';
        if (sizeAtRound === 8) return 'Quarterfinals';
        if (sizeAtRound === 16) return 'Round of 16';
        if (sizeAtRound === 32) return 'Round of 32';
        return TOURNEY_ROUND_NAMES_V2[roundIndex] || `Round ${roundIndex + 1}`;
    }

    function getTournamentColor(seed, total) {
        const hue = Math.round((seed * 360 / Math.max(total, 1) + 23) % 360);
        return `hsl(${hue}, 78%, 48%)`;
    }

    function getTournamentRosterText(roster) {
        return (roster || []).map(t => titleCaseName(t)).join(', ');
    }

    function getTournamentLegalFighters() {
        return (typeof FIGHTER_OPTIONS !== 'undefined' ? FIGHTER_OPTIONS : Object.keys(FIGHTER_DATA || {}))
            .filter(type => type && FIGHTER_DATA[type] && !['turret', 'boid', 'binder', 'mammoth_mount'].includes(type));
    }

    function getRandomTournamentRoster(size) {
        const options = getTournamentLegalFighters();
        const roster = [];
        for (let i = 0; i < size; i++) {
            roster.push(options[Math.floor(Math.random() * options.length)] || 'unarmed');
        }
        return roster;
    }

    function normalizeRoster(roster, size) {
        const options = getTournamentLegalFighters();
        let clean = (roster || [])
            .map(v => String(v || '').toLowerCase().trim())
            .filter(v => FIGHTER_DATA[v]);

        while (clean.length < size) {
            clean.push(options[Math.floor(Math.random() * options.length)] || 'unarmed');
        }

        return clean.slice(0, size);
    }

    function makeTournamentTeam(name, roster, seedIndex, isCustom = false) {
        const bracketSize = getTournamentBracketSize();
        const idPrefix = isCustom ? 'custom' : 'bot';
        return {
            id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: String(name || generateTeamName()).toUpperCase(),
            roster: normalizeRoster(roster, getTournamentTeamSize()),
            color: isCustom ? '#00c3ff' : getTournamentColor(seedIndex, bracketSize),
            wins: 0,
            losses: 0,
            seed: seedIndex + 1,
            isCustom
        };
    }

    function getCurrentP1RosterForTournament() {
        const inputs = Array.from(document.querySelectorAll('.p1-input'));
        const values = inputs.map(input => input.value).filter(Boolean);
        return normalizeRoster(values, getTournamentTeamSize());
    }

    function updatePoolUI() {
        const bracketSize = getTournamentBracketSize();
        const counter = safeGet('poolCounter');
        if (counter) counter.innerText = `${customTeamPool.length}/${bracketSize}`;

        const poolList = safeGet('tourneyPoolList');
        if (poolList) {
            if (!customTeamPool.length) {
                poolList.innerHTML = '<div style="opacity:.7;font-weight:800;text-align:center;padding:12px;">No teams added yet. Add P1 or bot teams, then start a bracket.</div>';
            } else {
                poolList.innerHTML = customTeamPool.map((team, index) => `
                    <div class="tourney-team-card" style="--team-color:${escapeHtml(team.color || getTournamentColor(index, bracketSize))};">
                        <div class="tourney-seed-dot"></div>
                        <div style="min-width:0;">
                            <div class="tourney-team-name">${index + 1}. ${escapeHtml(team.name)}</div>
                            <div class="tourney-team-roster">${escapeHtml(getTournamentRosterText(team.roster))}</div>
                        </div>
                        <button class="tourney-mini-btn" onclick="removeTournamentPoolTeam(${index})">Remove</button>
                    </div>
                `).join('');
            }
        }

        updateTournamentUI();
    }

    function removeTournamentPoolTeam(index) {
        if (index < 0 || index >= customTeamPool.length) return;
        customTeamPool.splice(index, 1);
        updatePoolUI();
    }

    function syncTournamentTeamSizeToSquads() {
        const size = getTournamentTeamSize();
        const p1 = safeGet('p1Count');
        const p2 = safeGet('p2Count');

        if (p1) p1.value = size;
        if (p2) p2.value = size;

        if (typeof updateSquadUI === 'function') updateSquadUI();
        updateTournamentUI();
    }

    function registerP1ToTourney() {
        const bracketSize = getTournamentBracketSize();
        if (customTeamPool.length >= bracketSize) {
            return showCustomMessage('Tournament Pool Full', `This bracket only has ${bracketSize} slots.`);
        }

        const roster = getCurrentP1RosterForTournament();
        const defaultName = `Player Team ${customTeamPool.length + 1}`;
        const entered = prompt('Enter tournament team name:', defaultName);
        if (entered === null) return;

        customTeamPool.push(makeTournamentTeam(entered || defaultName, roster, customTeamPool.length, true));
        if (typeof playSound === 'function') playSound('zap');
        updatePoolUI();
        showCustomMessage('Team Added', `${entered || defaultName} joined the tournament pool.`);
    }

    function addRandomTournamentTeam() {
        const bracketSize = getTournamentBracketSize();
        if (customTeamPool.length >= bracketSize) {
            return showCustomMessage('Tournament Pool Full', `This bracket only has ${bracketSize} slots.`);
        }

        customTeamPool.push(makeTournamentTeam(generateTeamName(), getRandomTournamentRoster(getTournamentTeamSize()), customTeamPool.length, false));
        updatePoolUI();
    }

    function fillTournamentPool() {
        const bracketSize = getTournamentBracketSize();
        while (customTeamPool.length < bracketSize) {
            addRandomTournamentTeam();
        }
        showCustomMessage('Bracket Filled', `${bracketSize} teams are ready.`);
    }

    function clearTourneyPool() {
        customTeamPool = [];
        updatePoolUI();
        showCustomMessage('Cleared', 'Tournament pool emptied.');
    }

    function buildTournamentFirstRound(teams) {
        const round = [];
        for (let i = 0; i < teams.length; i += 2) {
            round.push({
                p1: teams[i],
                p2: teams[i + 1],
                winner: null,
                score: null,
                resultReason: null,
                playedMode: null
            });
        }
        return round;
    }

    function initTournament() {
        const bracketSize = getTournamentBracketSize();
        const teamSize = getTournamentTeamSize();
        let newTeams = customTeamPool.map((team, index) => ({
            ...JSON.parse(JSON.stringify(team)),
            roster: normalizeRoster(team.roster, teamSize),
            seed: index + 1,
            color: team.color || getTournamentColor(index, bracketSize)
        }));

        while (newTeams.length < bracketSize) {
            newTeams.push(makeTournamentTeam(generateTeamName(), getRandomTournamentRoster(teamSize), newTeams.length, false));
        }

        if (newTeams.length > bracketSize) {
            newTeams = newTeams.slice(0, bracketSize);
        }

        if (getTournamentSeedStyle() === 'shuffle') {
            newTeams.sort(() => Math.random() - 0.5);
        }

        newTeams.forEach((team, index) => {
            team.seed = index + 1;
            if (!team.color) team.color = getTournamentColor(index, bracketSize);
        });

        tournamentData = {
            active: true,
            teams: newTeams,
            bracketSize,
            teamSize,
            ruleset: getTournamentRuleset(),
            seedStyle: getTournamentSeedStyle(),
            round: 0,
            matches: [buildTournamentFirstRound(newTeams)],
            currentMatchIndex: 0,
            champion: null,
            history: [],
            startedAt: Date.now()
        };

        isSetupPhase = true;
        isTournamentMatch = false;
        gameOverTriggered = false;
        updateTournamentUI();
        saveTournament(false);
        showCustomMessage('Tournament Started', `${bracketSize} teams. ${teamSize} fighters per team.`);
        if (typeof playSound === 'function') playSound('zap');
    }

    function getNextTournamentMatch() {
        if (!tournamentData || !tournamentData.active) return null;

        while (tournamentData.active) {
            const currentRound = tournamentData.matches[tournamentData.round];
            if (!currentRound) return null;

            const nextIndex = currentRound.findIndex(match => !match.winner);
            if (nextIndex !== -1) {
                tournamentData.currentMatchIndex = nextIndex;
                return currentRound[nextIndex];
            }

            if (currentRound.length === 1) {
                tournamentData.champion = currentRound[0].winner;
                updateTournamentUI();
                saveTournament(false);
                return null;
            }

            advanceRound();
        }

        return null;
    }

    function getTournamentTeamPower(team) {
        const ruleset = tournamentData.ruleset || getTournamentRuleset();
        const roster = team.roster || [];
        let power = 0;

        roster.forEach(type => {
            const data = FIGHTER_DATA[type] || FIGHTER_DATA.unarmed || { hp: 100 };
            const hp = Number(data.hp) || 100;
            let classBonus = 0;

            if (['bombman', 'mammoth', 'devourer', 'fight knight'].includes(type)) classBonus += 75;
            if (['laser', 'wizard', 'missile', 'soldier', 'bow', 'spearer'].includes(type)) classBonus += 45;
            if (['spider', 'samurai', 'rogue', 'trapper', 'scythe'].includes(type)) classBonus += 35;
            if (['healer', 'bard', 'engineer', 'necromancer', 'duplicator'].includes(type)) classBonus += 30;

            power += hp + classBonus;
        });

        const variety = new Set(roster).size;
        power += variety * 10;

        if (ruleset === 'survival') {
            power += roster.reduce((sum, type) => sum + ((FIGHTER_DATA[type]?.hp || 100) * 0.35), 0);
        }

        const chaos = ruleset === 'chaos' ? 0.55 : 0.22;
        power *= (1 - chaos / 2) + Math.random() * chaos;

        return power;
    }

    function markTournamentWinner(match, winner, mode, scoreText) {
        match.winner = winner;
        match.playedMode = mode;
        match.score = scoreText || '';
        match.resultReason = `${winner.name} advanced by ${mode === 'watch' ? 'watched battle' : 'simulation'}.`;

        winner.wins = (winner.wins || 0) + 1;
        const loser = winner === match.p1 ? match.p2 : match.p1;
        if (loser) loser.losses = (loser.losses || 0) + 1;

        if (!tournamentData.history) tournamentData.history = [];
        tournamentData.history.push({
            round: tournamentData.round,
            match: tournamentData.currentMatchIndex,
            p1: match.p1.name,
            p2: match.p2.name,
            winner: winner.name,
            mode,
            score: scoreText || '',
            time: Date.now()
        });
    }

    function playNextMatch(mode) {
        if (!tournamentData || !tournamentData.active) {
            return showCustomMessage('Tournament', 'Start a new tournament first.');
        }

        const match = getNextTournamentMatch();

        if (!match) {
            const champion = tournamentData.champion;
            if (champion) {
                showCustomMessage('Champion!', `${champion.name} wins the tournament!`);
            } else {
                showCustomMessage('Tournament', 'No playable match found.');
            }
            return;
        }

        if (mode === 'sim') {
            const score1 = getTournamentTeamPower(match.p1);
            const score2 = getTournamentTeamPower(match.p2);
            const winner = score1 >= score2 ? match.p1 : match.p2;
            markTournamentWinner(match, winner, 'sim', `${Math.round(score1)} - ${Math.round(score2)}`);
            updateTournamentUI();
            saveTournament(false);
            showCustomMessage('Match Simulated', `${winner.name} advances.`);
            return;
        }

        if (mode === 'watch') {
            loadTournamentTeams(match.p1, match.p2);
        }
    }

    function simulateTournamentRound() {
        if (!tournamentData || !tournamentData.active) {
            return showCustomMessage('Tournament', 'Start a tournament first.');
        }

        const round = tournamentData.matches[tournamentData.round];
        if (!round) return;

        let simulated = 0;
        round.forEach((match, index) => {
            if (match.winner) return;
            tournamentData.currentMatchIndex = index;
            const score1 = getTournamentTeamPower(match.p1);
            const score2 = getTournamentTeamPower(match.p2);
            const winner = score1 >= score2 ? match.p1 : match.p2;
            markTournamentWinner(match, winner, 'sim', `${Math.round(score1)} - ${Math.round(score2)}`);
            simulated++;
        });

        updateTournamentUI();
        saveTournament(false);
        showCustomMessage('Round Simulated', `${simulated} match${simulated === 1 ? '' : 'es'} resolved.`);
    }

    function simulateFullTournament() {
        if (!tournamentData || !tournamentData.active) {
            return showCustomMessage('Tournament', 'Start a tournament first.');
        }

        let guard = 0;
        while (!tournamentData.champion && guard < 200) {
            const match = getNextTournamentMatch();
            if (!match) break;

            const score1 = getTournamentTeamPower(match.p1);
            const score2 = getTournamentTeamPower(match.p2);
            const winner = score1 >= score2 ? match.p1 : match.p2;
            markTournamentWinner(match, winner, 'sim', `${Math.round(score1)} - ${Math.round(score2)}`);
            guard++;
        }

        updateTournamentUI();
        saveTournament(false);

        if (tournamentData.champion) {
            showCustomMessage('Champion!', `${tournamentData.champion.name} wins the tournament!`);
        } else {
            showCustomMessage('Tournament', 'Simulation paused before a champion was found.');
        }
    }

    function advanceRound() {
        const currentRound = tournamentData.matches[tournamentData.round];
        if (!currentRound || currentRound.some(match => !match.winner)) return;

        if (currentRound.length === 1) {
            tournamentData.champion = currentRound[0].winner;
            updateTournamentUI();
            saveTournament(false);
            return;
        }

        const nextRound = [];
        for (let i = 0; i < currentRound.length; i += 2) {
            nextRound.push({
                p1: currentRound[i].winner,
                p2: currentRound[i + 1].winner,
                winner: null,
                score: null,
                resultReason: null,
                playedMode: null
            });
        }

        tournamentData.round++;
        tournamentData.matches.push(nextRound);
        tournamentData.currentMatchIndex = 0;
        updateTournamentUI();
        saveTournament(false);
    }

    function saveTournament(showToast = true) {
        if (!tournamentData || !tournamentData.active) {
            if (showToast) showCustomMessage('Tournament', 'No active tournament to save.');
            return;
        }

        localStorage.setItem('ballBattle_tournament_save', JSON.stringify(tournamentData));

        if (showToast) {
            showCustomMessage('Saved', 'Tournament progress saved.');
        }

        updateTournamentUI();
    }

    function loadTournament() {
        const data = localStorage.getItem('ballBattle_tournament_save');

        if (!data) {
            return showCustomMessage('Load Failed', 'No saved tournament found.');
        }

        try {
            tournamentData = JSON.parse(data);
            if (!tournamentData.history) tournamentData.history = [];
            if (!tournamentData.bracketSize) tournamentData.bracketSize = tournamentData.teams ? tournamentData.teams.length : 16;
            if (!tournamentData.teamSize) tournamentData.teamSize = getTournamentTeamSize();

            const bracketSizeEl = safeGet('tourneyBracketSize');
            if (bracketSizeEl && tournamentData.bracketSize) bracketSizeEl.value = String(tournamentData.bracketSize);

            const teamSizeEl = safeGet('tourneyTeamSize');
            if (teamSizeEl && tournamentData.teamSize) teamSizeEl.value = String(tournamentData.teamSize);

            const rulesEl = safeGet('tourneyRuleset');
            if (rulesEl && tournamentData.ruleset) rulesEl.value = tournamentData.ruleset;

            const modeSelect = safeGet('modeSelect');
            if (modeSelect) modeSelect.value = 'tournament';

            toggleGameMode();
            updateTournamentUI();
            showCustomMessage('Loaded', 'Tournament save restored.');
        } catch (err) {
            console.error(err);
            showCustomMessage('Load Failed', 'The saved tournament data was corrupted.');
        }
    }

    function exitTournament() {
        isTournamentMatch = false;
        isSetupPhase = true;
        const modeSelect = safeGet('modeSelect');
        if (modeSelect) modeSelect.value = 'team';
        toggleGameMode();
        resetPositions();
    }

    function loadTournamentTeams(team1, team2) {
        entities = [];
        obstacles = [];
        projectiles = [];
        decals = [];

        isTournamentMatch = true;
        isSetupPhase = true;
        gameOverTriggered = false;

        const totalFighters = (team1.roster?.length || 0) + (team2.roster?.length || 0);
        const mapSelect = safeGet('mapSizeSelect');

        if (mapSelect && totalFighters >= 20 && ['small', 'normal'].includes(mapSelect.value)) {
            mapSelect.value = totalFighters >= 50 ? 'huge' : 'large';
        }

        if (typeof changeMapSize === 'function') changeMapSize();

        const spawnTeam = (team, teamNumber, sideKey) => {
            (team.roster || []).forEach((type, index) => {
                const fallbackX = teamNumber === 1 ? canvas.width * 0.22 : canvas.width * 0.78;
                const fallbackY = 80 + index * 42;
                const fighter = createFighter(type, fallbackX, fallbackY, teamNumber, false, null, null, sideKey, index);
                const pos = typeof getSafeSpawnPos === 'function'
                    ? getSafeSpawnPos(teamNumber)
                    : { x: fallbackX, y: fallbackY };

                fighter.x = pos.x;
                fighter.y = pos.y;
                fighter.color = team.color;
                fighter.tournamentTeamName = team.name;
                fighter.displayName = `${team.name} ${index + 1}`;
                entities.push(fighter);
            });
        };

        spawnTeam(team1, 1, 'p1');
        spawnTeam(team2, 2, 'p2');

        if (typeof randomizeObstacles === 'function') randomizeObstacles();

        battleStartFrame = frameCount || 0;
        battleTotalKills = 0;
        battleStats = {};
        entities.forEach(e => {
            if (typeof ensureBattleStat === 'function') ensureBattleStat(e);
        });

        isSetupPhase = false;
        gameActive = true;

        if (typeof resetCamera === 'function') resetCamera();
        if (typeof updateLiveCounts === 'function') updateLiveCounts();

        resultModal.style.display = 'none';
        playBGM('battle');

        const title = safeGet('mainTitle');
        if (title) {
            title.innerHTML = `<span style="color:${team1.color}">${escapeHtml(team1.name)}</span> VS <span style="color:${team2.color}">${escapeHtml(team2.name)}</span>`;
        }

        updateTournamentUI();
    }

    function updateTournamentUI() {
        removePetOptionsFromSelects();

        const bracketSize = getTournamentBracketSize();
        const status = safeGet('tourneyStatus');
        const champ = safeGet('tourneyChampionBanner');
        const bracketPanel = safeGet('tourneyBracketPanel');

        const counter = safeGet('poolCounter');
        if (counter) counter.innerText = `${customTeamPool.length}/${bracketSize}`;

        if (!tournamentData || !tournamentData.active) {
            if (status) status.innerText = `No active tournament. Pool: ${customTeamPool.length}/${bracketSize}.`;
            if (champ) champ.innerText = 'No champion yet';
            if (bracketPanel) bracketPanel.innerHTML = '<div style="opacity:.7;font-weight:800;text-align:center;padding:14px;">Start a new bracket to see matches here.</div>';
            return;
        }

        const roundName = getTournamentRoundName(tournamentData.round, tournamentData.bracketSize || bracketSize);
        const currentRound = tournamentData.matches[tournamentData.round] || [];
        const nextIndex = currentRound.findIndex(match => !match.winner);
        const champion = tournamentData.champion || (currentRound.length === 1 && currentRound[0].winner ? currentRound[0].winner : null);

        if (champ) {
            champ.innerText = champion ? `Champion: ${champion.name}` : 'No champion yet';
        }

        if (status) {
            if (champion) {
                status.innerText = `Champion crowned: ${champion.name}.`;
            } else if (nextIndex === -1) {
                status.innerText = `${roundName} complete. Press Sim/Watch Next to advance.`;
            } else {
                const match = currentRound[nextIndex];
                status.innerText = `${roundName} — Match ${nextIndex + 1}: ${match.p1.name} vs ${match.p2.name}`;
            }
        }

        renderTournamentBracketPanel();
    }

    function renderTournamentBracketPanel() {
        const panel = safeGet('tourneyBracketPanel');
        if (!panel) return;

        if (!tournamentData || !tournamentData.active || !tournamentData.matches) {
            panel.innerHTML = '<div style="opacity:.7;font-weight:800;text-align:center;padding:14px;">Start a tournament first.</div>';
            return;
        }

        const nextRound = tournamentData.round;
        const nextMatchIndex = (tournamentData.matches[nextRound] || []).findIndex(match => !match.winner);

        panel.innerHTML = tournamentData.matches.map((round, rIndex) => {
            const title = getTournamentRoundName(rIndex, tournamentData.bracketSize || tournamentData.teams.length);
            const matches = round.map((match, mIndex) => {
                const isCurrent = rIndex === nextRound && mIndex === nextMatchIndex && !match.winner && !tournamentData.champion;
                const done = !!match.winner;
                const p1Winner = match.winner && match.winner.id === match.p1.id;
                const p2Winner = match.winner && match.winner.id === match.p2.id;

                return `
                    <div class="tourney-match-card ${isCurrent ? 'current' : ''} ${done ? 'done' : ''}">
                        <div class="tourney-side">
                            <div class="tourney-side-name ${p1Winner ? 'winner' : ''}" style="color:${escapeHtml(match.p1.color || '#333')}">${escapeHtml(match.p1.name)}</div>
                            <div class="tourney-team-roster">${escapeHtml(getTournamentRosterText(match.p1.roster))}</div>
                        </div>
                        <div class="tourney-vs">${done ? '✓' : 'VS'}</div>
                        <div class="tourney-side">
                            <div class="tourney-side-name ${p2Winner ? 'winner' : ''}" style="color:${escapeHtml(match.p2.color || '#333')}">${escapeHtml(match.p2.name)}</div>
                            <div class="tourney-team-roster">${escapeHtml(getTournamentRosterText(match.p2.roster))}</div>
                        </div>
                        <div class="tourney-match-meta">${done ? `Winner: ${escapeHtml(match.winner.name)} ${match.score ? `(${escapeHtml(match.score)})` : ''}` : (isCurrent ? 'Next match' : 'Waiting')}</div>
                    </div>
                `;
            }).join('');

            return `<div class="tourney-round-title">${escapeHtml(title)}</div>${matches}`;
        }).join('');
    }

    function drawTournamentBracketV2() {
        const isDark = document.body.classList.contains('dark-mode');

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, isDark ? '#111827' : '#f8f9fa');
        grad.addColorStop(1, isDark ? '#2d3436' : '#dfe6e9');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = isDark ? '#f1c40f' : '#111';
        ctx.font = `900 ${Math.max(18, canvas.width * 0.035)}px "Segoe UI", Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('TOURNAMENT BRACKET', canvas.width / 2, 42);

        if (!tournamentData || !tournamentData.active) {
            ctx.fillStyle = isDark ? '#ddd' : '#333';
            ctx.font = 'bold 16px "Segoe UI", Arial';
            ctx.fillText('Create a new bracket in the Tournament Hub.', canvas.width / 2, canvas.height / 2);
            return;
        }

        const rounds = tournamentData.matches || [];
        const totalTeams = tournamentData.bracketSize || (tournamentData.teams ? tournamentData.teams.length : 16);
        const marginX = 24;
        const top = 76;
        const usableW = canvas.width - marginX * 2;
        const usableH = canvas.height - top - 30;
        const colW = usableW / Math.max(rounds.length, 1);
        const boxW = Math.min(210, colW * 0.78);
        const boxH = Math.max(34, Math.min(52, usableH / Math.max(9, rounds[0]?.length || 8) * 0.58));

        rounds.forEach((round, rIndex) => {
            const x = marginX + rIndex * colW + (colW - boxW) / 2;

            ctx.fillStyle = isDark ? '#f1c40f' : '#2f3542';
            ctx.font = '900 12px "Segoe UI", Arial';
            ctx.textAlign = 'center';
            ctx.fillText(getTournamentRoundName(rIndex, totalTeams).toUpperCase(), x + boxW / 2, top - 18);

            const rowGap = usableH / Math.max(round.length, 1);

            round.forEach((match, mIndex) => {
                const y = top + mIndex * rowGap + rowGap / 2 - boxH / 2;
                const isCurrent = rIndex === tournamentData.round &&
                    mIndex === (round.findIndex(m => !m.winner)) &&
                    !match.winner &&
                    !tournamentData.champion;

                if (rIndex < rounds.length - 1) {
                    const nextRound = rounds[rIndex + 1];
                    const nextY = top + Math.floor(mIndex / 2) * (usableH / Math.max(nextRound.length, 1)) + (usableH / Math.max(nextRound.length, 1)) / 2;
                    ctx.strokeStyle = isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.20)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(x + boxW, y + boxH / 2);
                    ctx.lineTo(x + colW, nextY);
                    ctx.stroke();
                }

                ctx.fillStyle = match.winner ? 'rgba(46,204,113,.22)' : (isDark ? '#2f3542' : '#ffffff');
                ctx.strokeStyle = isCurrent ? '#f1c40f' : (isDark ? '#636e72' : '#111');
                ctx.lineWidth = isCurrent ? 4 : 2;
                ctx.shadowColor = isCurrent ? 'rgba(241,196,15,.7)' : 'rgba(0,0,0,.2)';
                ctx.shadowBlur = isCurrent ? 12 : 4;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 7);
                else ctx.rect(x, y, boxW, boxH);
                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0;

                const text = match.winner
                    ? `✓ ${match.winner.name}`
                    : `${match.p1.name} vs ${match.p2.name}`;

                ctx.fillStyle = isDark ? '#fff' : '#111';
                ctx.font = `800 ${Math.max(9, Math.min(12, boxH * 0.32))}px "Segoe UI", Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                let clipped = text;
                while (ctx.measureText(clipped).width > boxW - 14 && clipped.length > 4) {
                    clipped = clipped.slice(0, -2);
                }
                if (clipped !== text) clipped += '…';
                ctx.fillText(clipped, x + boxW / 2, y + boxH / 2);
            });
        });

        if (tournamentData.champion) {
            ctx.fillStyle = '#f1c40f';
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 3;
            const w = Math.min(360, canvas.width * 0.7);
            const h = 48;
            const x = (canvas.width - w) / 2;
            const y = canvas.height - h - 12;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
            else ctx.rect(x, y, w, h);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#111';
            ctx.font = '900 16px "Segoe UI", Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`CHAMPION: ${tournamentData.champion.name}`, canvas.width / 2, y + h / 2);
        }
    }

    function bootTournamentRevamp() {
        removePetOptionsFromSelects();

        const mainMode = safeGet('modeSelect');
        if (mainMode && mainMode.value === 'pet') mainMode.value = 'team';

        const fsMode = safeGet('fsModeSelect');
        if (fsMode && fsMode.value === 'pet') fsMode.value = 'team';

        updatePoolUI();
        updateTournamentUI();
    }

    // Override older tournament functions.
    window.removeTournamentPoolTeam = removeTournamentPoolTeam;
    window.syncTournamentTeamSizeToSquads = syncTournamentTeamSizeToSquads;
    window.registerP1ToTourney = registerP1ToTourney;
    window.addRandomTournamentTeam = addRandomTournamentTeam;
    window.fillTournamentPool = fillTournamentPool;
    window.clearTourneyPool = clearTourneyPool;
    window.updatePoolUI = updatePoolUI;
    window.initTournament = initTournament;
    window.playNextMatch = playNextMatch;
    window.simulateTournamentRound = simulateTournamentRound;
    window.simulateFullTournament = simulateFullTournament;
    window.advanceRound = advanceRound;
    window.saveTournament = saveTournament;
    window.loadTournament = loadTournament;
    window.exitTournament = exitTournament;
    window.loadTournamentTeams = loadTournamentTeams;
    window.updateTournamentUI = updateTournamentUI;

    registerP1ToTourney = registerP1ToTourney;
    clearTourneyPool = clearTourneyPool;
    updatePoolUI = updatePoolUI;
    initTournament = initTournament;
    playNextMatch = playNextMatch;
    loadTournamentTeams = loadTournamentTeams;
    advanceRound = advanceRound;
    saveTournament = saveTournament;
    loadTournament = loadTournament;
    exitTournament = exitTournament;

    if (typeof toggleGameMode === 'function' && !toggleGameMode.__tourneyRevampWrapped) {
        const oldToggleGameMode = toggleGameMode;
        toggleGameMode = function tournamentRevampToggleGameMode() {
            removePetOptionsFromSelects();
            const modeSelect = safeGet('modeSelect');
            if (modeSelect && modeSelect.value === 'pet') modeSelect.value = 'team';

            const result = oldToggleGameMode.apply(this, arguments);

            if (GAME_MODE === 'pet') {
                GAME_MODE = 'team';
                if (modeSelect) modeSelect.value = 'team';
                return oldToggleGameMode.apply(this, arguments);
            }

            if (GAME_MODE === 'tournament') {
                const title = safeGet('mainTitle');
                if (title) title.innerHTML = '<span style="color:gold">TOURNAMENT BRACKET</span>';

                const tourneyControls = safeGet('tournamentControls');
                if (tourneyControls) tourneyControls.style.display = 'flex';

                updateTournamentUI();
            }

            return result;
        };
        toggleGameMode.__tourneyRevampWrapped = true;
        window.toggleGameMode = toggleGameMode;
    }

    if (typeof setGameModeFromValue === 'function' && !setGameModeFromValue.__tourneyRevampWrapped) {
        const oldSetGameModeFromValue = setGameModeFromValue;
        setGameModeFromValue = function tournamentRevampSetGameModeFromValue(mode) {
            if (mode === 'pet') mode = 'team';
            return oldSetGameModeFromValue.call(this, mode);
        };
        setGameModeFromValue.__tourneyRevampWrapped = true;
        window.setGameModeFromValue = setGameModeFromValue;
    }

    if (typeof updateWeaponDropdown === 'function' && !updateWeaponDropdown.__petRemovalWrapped) {
        const oldUpdateWeaponDropdown = updateWeaponDropdown;
        updateWeaponDropdown = function petRemovalUpdateWeaponDropdown() {
            const result = oldUpdateWeaponDropdown.apply(this, arguments);
            const daggerOpt = document.querySelector("#weaponSelect option[value='dagger']");
            const gunOpt = document.querySelector("#weaponSelect option[value='gun']");
            const scytheOpt = document.querySelector("#weaponSelect option[value='scythe']");
            if (daggerOpt) daggerOpt.innerText = 'Place: Dagger';
            if (gunOpt) gunOpt.innerText = 'Place: Gun';
            if (scytheOpt) scytheOpt.innerText = 'Place: Scythe';
            return result;
        };
        updateWeaponDropdown.__petRemovalWrapped = true;
        window.updateWeaponDropdown = updateWeaponDropdown;
    }

    if (typeof endGame === 'function' && !endGame.__tourneyRevampWrapped) {
        const oldEndGame = endGame;
        endGame = function tournamentRevampEndGame(text) {
            const wasTournament = !!(isTournamentMatch && tournamentData && tournamentData.active);
            const roundIndex = wasTournament ? tournamentData.round : null;
            const matchIndex = wasTournament ? tournamentData.currentMatchIndex : null;
            const result = oldEndGame.apply(this, arguments);

            if (wasTournament) {
                setTimeout(() => {
                    const round = tournamentData.matches && tournamentData.matches[roundIndex];
                    const match = round && round[matchIndex];

                    if (match && match.winner) {
                        match.playedMode = 'watch';
                        match.resultReason = `${match.winner.name} advanced by watched battle.`;
                        if (!match.score) match.score = 'watched';
                    }

                    updateTournamentUI();
                    saveTournament(false);
                }, 80);

                setTimeout(() => {
                    updateTournamentUI();
                }, 3200);
            }

            return result;
        };
        endGame.__tourneyRevampWrapped = true;
        window.endGame = endGame;
    }

    if (typeof draw === 'function' && !draw.__tourneyRevampWrapped) {
        const oldDraw = draw;
        draw = function tournamentRevampDraw() {
            if (GAME_MODE === 'tournament' && !isTournamentMatch && tournamentData && tournamentData.active) {
                drawTournamentBracketV2();
                return;
            }
            return oldDraw.apply(this, arguments);
        };
        draw.__tourneyRevampWrapped = true;
        window.draw = draw;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootTournamentRevamp);
    } else {
        bootTournamentRevamp();
    }
})();


// --- CUSTOM TOURNAMENT TEAM BUILDER + CAMPAIGN ADVENTURE MODE PATCH ---
(function farrelCampaignAndTournamentCustomPatch() {
    const CAMPAIGN_SAVE_KEY = 'ballBattle_campaign_save_v1';
    let tournamentCustomRoster = [];
    let campaignBattleActive = false;
    let campaignBattleResolved = false;
    let campaignLastEnemyRoster = [];

    function getEl(id) { return document.getElementById(id); }
    function esc(value) {
        if (typeof escapeHtml === 'function') return escapeHtml(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    }
    function niceName(type) {
        if (typeof titleCaseName === 'function') return titleCaseName(type);
        return String(type || '').replace(/\b\w/g, m => m.toUpperCase());
    }
    function legalFighters() {
        return (typeof FIGHTER_OPTIONS !== 'undefined' ? FIGHTER_OPTIONS : Object.keys(FIGHTER_DATA || {}))
            .filter(type => type && FIGHTER_DATA[type] && !['turret', 'boid', 'binder', 'skeleton', 'mammoth_mount', 'empty'].includes(type));
    }
    function readSelectedFighter(selectId) {
        const el = getEl(selectId);
        const type = el ? String(el.value || '').toLowerCase() : '';
        return legalFighters().includes(type) ? type : 'unarmed';
    }
    function fighterDamageScore(type) {
        const data = FIGHTER_DATA[type] || {};
        const raw = String(data.dmg || '').toLowerCase();
        if (raw.includes('fatal')) return 78;
        if (raw.includes('v. high') || raw.includes('very')) return 66;
        if (raw.includes('heavy') || raw.includes('burst') || raw.includes('high')) return 54;
        if (raw.includes('medium')) return 35;
        if (raw.includes('adaptive') || raw.includes('scaling') || raw.includes('water') || raw.includes('pierce')) return 42;
        if (raw.includes('low')) return 20;
        return 32;
    }
    function fighterEffectivenessBonus(type) {
        const bonus = {
            bombman: 190, missile: 125, devourer: 160, mammoth: 135, spider: 125,
            grower: 105, regenerator: 95, adapto: 95, duplicator: 90, necromancer: 85,
            engineer: 80, spearer: 85, spatial: 90, vampire: 75, aquamarine: 72,
            fight_knight: 100, 'fight knight': 100, pirate: 70, soldier: 60, laser: 62,
            wizard: 45, bow: 45, rogue: 55, samurai: 65, scythe: 60, trapper: 58,
            knight: 50, lance: 50, bard: 45, chameleon: 60, chrono: 55, dualist: 62,
            unarmed: 20, swarm: 80
        };
        return bonus[type] || 35;
    }
    function fighterPrice(type) {
        const data = FIGHTER_DATA[type] || { hp: 100 };
        const hp = Number(data.hp || 100);
        const dmg = fighterDamageScore(type);
        const price = Math.round((hp * 0.42 + dmg * 3.4 + fighterEffectivenessBonus(type)) / 5) * 5;
        return Math.max(55, Math.min(650, price));
    }
    function buildTeamObject(name, roster, isCustom) {
        const bracketSizeEl = getEl('tourneyBracketSize');
        const bracketSize = bracketSizeEl ? parseInt(bracketSizeEl.value, 10) || 16 : 16;
        const index = Array.isArray(customTeamPool) ? customTeamPool.length : 0;
        return {
            id: `${isCustom ? 'custom' : 'bot'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: String(name || `Custom Team ${index + 1}`).trim().toUpperCase(),
            roster: (roster && roster.length ? roster : ['unarmed']).slice(0, getTournamentTeamSizeSafe()),
            color: isCustom ? '#00c3ff' : `hsl(${Math.round((index * 360 / Math.max(bracketSize, 1) + 23) % 360)},78%,48%)`,
            wins: 0,
            losses: 0,
            seed: index + 1,
            isCustom: !!isCustom
        };
    }
    function getTournamentTeamSizeSafe() {
        const el = getEl('tourneyTeamSize');
        const n = parseInt(el ? el.value : 5, 10) || 5;
        return Math.max(1, Math.min(30, n));
    }
    function populateFighterSelect(selectId) {
        const select = getEl(selectId);
        if (!select) return;
        const old = select.value;
        select.innerHTML = legalFighters().map(type => {
            const data = FIGHTER_DATA[type] || {};
            const price = fighterPrice(type);
            return `<option value="${esc(type)}">${esc(niceName(type))}${selectId === 'campaignShopSelect' ? ` — $${price}` : ''}</option>`;
        }).join('');
        if (old && legalFighters().includes(old)) select.value = old;
    }

    // ---------- Tournament custom team builder ----------
    function renderTournamentCustomRoster() {
        const list = getEl('tourneyCustomRosterList');
        if (!list) return;
        const max = getTournamentTeamSizeSafe();
        if (!tournamentCustomRoster.length) {
            list.innerHTML = `No custom fighters selected yet. Pick up to ${max}.`;
            return;
        }
        list.innerHTML = tournamentCustomRoster.map((type, index) => `
            <span class="tourney-roster-chip">
                ${esc(niceName(type))}
                <button type="button" onclick="removeTournamentCustomFighter(${index})">×</button>
            </span>
        `).join('') + `<span class="tourney-roster-chip" style="background:#f1c40f;">${tournamentCustomRoster.length}/${max}</span>`;
    }
    function addTournamentCustomFighter() {
        const max = getTournamentTeamSizeSafe();
        if (tournamentCustomRoster.length >= max) {
            return showCustomMessage('Custom Team Full', `This tournament team size is ${max}.`);
        }
        tournamentCustomRoster.push(readSelectedFighter('tourneyCustomFighterSelect'));
        renderTournamentCustomRoster();
    }
    function removeTournamentCustomFighter(index) {
        tournamentCustomRoster.splice(index, 1);
        renderTournamentCustomRoster();
    }
    function clearTournamentCustomRoster() {
        tournamentCustomRoster = [];
        renderTournamentCustomRoster();
    }
    function addCustomTournamentTeamToBracket() {
        const bracketSize = (() => {
            const el = getEl('tourneyBracketSize');
            return el ? parseInt(el.value, 10) || 16 : 16;
        })();
        if (!Array.isArray(customTeamPool)) customTeamPool = [];
        if (customTeamPool.length >= bracketSize) {
            return showCustomMessage('Bracket Full', `This bracket already has ${bracketSize} teams.`);
        }
        if (!tournamentCustomRoster.length) {
            return showCustomMessage('No Fighters', 'Add at least one fighter to the custom team first.');
        }
        const needed = getTournamentTeamSizeSafe();
        if (tournamentCustomRoster.length < needed) {
            return showCustomMessage('Team Not Full', `This bracket team size is ${needed}. Add ${needed - tournamentCustomRoster.length} more fighter${needed - tournamentCustomRoster.length === 1 ? '' : 's'} or lower Team Size.`);
        }
        const nameInput = getEl('tourneyCustomTeamName');
        const defaultName = `Custom Team ${customTeamPool.length + 1}`;
        const teamName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : defaultName;
        customTeamPool.push(buildTeamObject(teamName, tournamentCustomRoster.slice(), true));
        clearTournamentCustomRoster();
        if (nameInput) nameInput.value = `Custom Team ${customTeamPool.length + 1}`;
        if (typeof updatePoolUI === 'function') updatePoolUI();
        if (typeof updateTournamentUI === 'function') updateTournamentUI();
        showCustomMessage('Added to Bracket', `${teamName} entered the tournament bracket pool.`);
    }

    window.addTournamentCustomFighter = addTournamentCustomFighter;
    window.removeTournamentCustomFighter = removeTournamentCustomFighter;
    window.clearTournamentCustomRoster = clearTournamentCustomRoster;
    window.addCustomTournamentTeamToBracket = addCustomTournamentTeamToBracket;

    // ---------- Campaign mode ----------
    function defaultCampaignState() {
        return {
            level: 1,
            gold: 260,
            roster: [],
            currentEnemy: null,
            wins: 0,
            losses: 0,
            lastReward: 0
        };
    }
    let campaignState = loadCampaignState();

    function loadCampaignState() {
        try {
            const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
            if (!raw) return defaultCampaignState();
            const parsed = JSON.parse(raw);
            return {
                ...defaultCampaignState(),
                ...parsed,
                roster: Array.isArray(parsed.roster) ? parsed.roster.filter(type => FIGHTER_DATA[type]) : [],
                currentEnemy: Array.isArray(parsed.currentEnemy) ? parsed.currentEnemy.filter(type => FIGHTER_DATA[type]) : null
            };
        } catch (err) {
            return defaultCampaignState();
        }
    }
    function saveCampaignState(showToast = false) {
        try {
            localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(campaignState));
        } catch (err) {
            console.warn('Could not save campaign:', err);
        }
        if (showToast) showCustomMessage('Campaign Saved', 'Your adventure progress was saved.');
        renderCampaignUI();
    }
    function resetCampaignRun() {
        if (!confirm('Start a fresh campaign run? This clears your campaign squad and gold.')) return;
        campaignState = defaultCampaignState();
        campaignBattleActive = false;
        campaignBattleResolved = false;
        saveCampaignState(false);
        renderCampaignUI();
        showCustomMessage('New Campaign', 'Fresh run started. Buy fighters, then start Level 1.');
    }
    function getCampaignEnemyPool(level) {
        if (level <= 2) return ['unarmed', 'unarmed', 'bow', 'rogue'];
        if (level <= 4) return ['unarmed', 'bow', 'rogue', 'wizard', 'soldier', 'knight'];
        if (level <= 7) return ['soldier', 'knight', 'laser', 'pirate', 'trapper', 'samurai', 'aquamarine'];
        if (level <= 10) return ['samurai', 'scythe', 'spearer', 'engineer', 'adapto', 'vampire', 'spider'];
        if (level <= 15) return ['spider', 'missile', 'mammoth', 'bombman', 'grower', 'duplicator', 'necromancer', 'spatial'];
        return legalFighters().filter(t => !['devourer', 'whispers'].includes(t)).concat(['devourer']);
    }
    function generateCampaignEnemy(level) {
        if (level === 1) return ['unarmed'];
        if (level === 2) return ['unarmed', 'bow'];
        if (level === 3) return ['soldier', 'unarmed'];
        if (level === 4) return ['knight', 'rogue', 'wizard'];
        if (level === 5) return ['pirate', 'soldier', 'unarmed'];

        const pool = getCampaignEnemyPool(level);
        let budget = 115 + level * 42 + Math.floor(level / 5) * 85;
        if (level % 5 === 0) budget += 125;
        const roster = [];
        let guard = 0;
        while (budget > 55 && roster.length < Math.min(4 + Math.floor(level / 2), 18) && guard++ < 80) {
            const affordable = pool.filter(type => fighterPrice(type) * 0.72 <= budget);
            const pickPool = affordable.length ? affordable : ['unarmed'];
            const type = pickPool[Math.floor(Math.random() * pickPool.length)];
            roster.push(type);
            budget -= Math.max(45, fighterPrice(type) * 0.72);
        }
        if (!roster.length) roster.push('unarmed');
        if (level % 5 === 0) {
            const bosses = level < 10 ? ['pirate', 'samurai', 'scythe'] : level < 15 ? ['spider', 'mammoth', 'missile'] : ['bombman', 'grower', 'spatial'];
            roster[0] = bosses[Math.floor(Math.random() * bosses.length)];
        }
        return roster;
    }
    function ensureCampaignEnemy() {
        if (!Array.isArray(campaignState.currentEnemy) || campaignState.currentEnemy.length === 0) {
            campaignState.currentEnemy = generateCampaignEnemy(campaignState.level);
        }
        return campaignState.currentEnemy;
    }
    function renderCampaignUI() {
        populateFighterSelect('campaignShopSelect');
        const enemy = ensureCampaignEnemy();
        const badge = getEl('campaignStatusBadge');
        if (badge) {
            badge.innerText = `Level ${campaignState.level} · $${campaignState.gold} · ${campaignState.wins}W/${campaignState.losses}L`;
        }
        const shop = getEl('campaignShopSelect');
        const info = getEl('campaignShopInfo');
        if (shop && info) {
            const type = readSelectedFighter('campaignShopSelect');
            const data = FIGHTER_DATA[type] || {};
            info.innerHTML = `<b>${esc(niceName(type))}</b> — $${fighterPrice(type)}<br>HP ${esc(data.hp || '?')} · Damage ${esc(data.dmg || '?')}<br>${esc(data.ability || '')}<br><span style="opacity:.7">${esc(data.desc || '')}</span>`;
        }
        const rosterList = getEl('campaignRosterList');
        if (rosterList) {
            rosterList.innerHTML = campaignState.roster.length ? campaignState.roster.map((type, index) => `
                <span class="campaign-roster-chip">
                    ${esc(niceName(type))}
                    <button type="button" onclick="sellCampaignFighter(${index})" title="Sell for half price">×</button>
                </span>
            `).join('') : 'No fighters bought yet. Buy at least one fighter to start.';
        }
        const enemyList = getEl('campaignEnemyPreview');
        if (enemyList) {
            const totalValue = enemy.reduce((sum, type) => sum + fighterPrice(type), 0);
            enemyList.innerHTML = `<div style="width:100%;font-weight:900;margin-bottom:4px;">Level ${campaignState.level} Enemy · est. $${Math.round(totalValue * .72)}</div>` + enemy.map(type => `
                <span class="campaign-enemy-chip">${esc(niceName(type))}</span>
            `).join('');
        }
    }
    function buyCampaignFighter() {
        const type = readSelectedFighter('campaignShopSelect');
        const price = fighterPrice(type);
        if (campaignState.gold < price) {
            return showCustomMessage('Not Enough Money', `${niceName(type)} costs $${price}. You have $${campaignState.gold}.`);
        }
        campaignState.gold -= price;
        campaignState.roster.push(type);
        saveCampaignState(false);
        if (typeof playSound === 'function') playSound('equip');
        showCustomMessage('Fighter Bought', `${niceName(type)} joined your campaign squad.`);
    }
    function sellCampaignFighter(index) {
        if (index < 0 || index >= campaignState.roster.length) return;
        const [type] = campaignState.roster.splice(index, 1);
        campaignState.gold += Math.floor(fighterPrice(type) * 0.5);
        saveCampaignState(false);
    }
    function clearCampaignRoster() {
        campaignState.roster.forEach(type => { campaignState.gold += Math.floor(fighterPrice(type) * 0.5); });
        campaignState.roster = [];
        saveCampaignState(false);
    }
    function autoBuyCampaignSquad() {
        const level = campaignState.level;
        const plan = level < 3 ? ['soldier', 'unarmed', 'bow']
            : level < 6 ? ['knight', 'soldier', 'wizard', 'rogue']
            : level < 10 ? ['spearer', 'samurai', 'aquamarine', 'trapper', 'soldier']
            : ['spider', 'missile', 'mammoth', 'adapto', 'spearer', 'wizard'];
        let bought = 0;
        for (const type of plan) {
            const price = fighterPrice(type);
            if (FIGHTER_DATA[type] && campaignState.gold >= price) {
                campaignState.gold -= price;
                campaignState.roster.push(type);
                bought++;
            }
        }
        saveCampaignState(false);
        showCustomMessage('Auto Buy', bought ? `Bought ${bought} useful fighter${bought === 1 ? '' : 's'} for this level.` : 'Not enough money for the suggested fighters.');
    }
    function rerollCampaignEnemy() {
        campaignState.currentEnemy = generateCampaignEnemy(campaignState.level);
        saveCampaignState(false);
        showCustomMessage('Scouted', 'New enemy squad generated.');
    }
    function spawnCampaignTeam(roster, team, sideKey, teamColor) {
        roster.forEach((type, index) => {
            const spawn = typeof getSafeSpawnPos === 'function'
                ? getSafeSpawnPos(team, 28)
                : { x: team === 1 ? canvas.width * 0.22 : canvas.width * 0.78, y: 90 + index * 42 };
            const fighter = createFighter(type, spawn.x, spawn.y, team, false, null, null, sideKey, index);
            fighter.initialX = fighter.x;
            fighter.initialY = fighter.y;
            fighter.nameIndex = index + 1;
            fighter.displayName = team === 1 ? `Campaign ${niceName(type)} ${index + 1}` : `Enemy ${niceName(type)} ${index + 1}`;
            fighter.campaignUnit = true;
            fighter.color = teamColor || fighter.color;
            entities.push(fighter);
            if (type === 'necromancer') {
                spawnSkeleton(fighter.x + (team === 1 ? -30 : 30), fighter.y + 20, team, fighter.id);
                spawnSkeleton(fighter.x + (team === 1 ? -30 : 30), fighter.y - 20, team, fighter.id);
            }
            if (type === 'dualist') {
                const pet = createFighter('binder', fighter.x + (team === 1 ? -40 : 40), fighter.y, team, true, fighter.id);
                pet.ownerId = fighter.id;
                pet.color = fighter.color;
                entities.push(pet);
            }
        });
    }
    function startCampaignBattle() {
        if (!campaignState.roster.length) {
            return showCustomMessage('No Squad', 'Buy at least one fighter before starting the campaign level.');
        }
        const modeSelect = getEl('modeSelect');
        if (modeSelect) modeSelect.value = 'campaign';
        GAME_MODE = 'campaign';
        campaignBattleActive = true;
        campaignBattleResolved = false;
        campaignLastEnemyRoster = ensureCampaignEnemy().slice();

        entities = [];
        obstacles = [];
        projectiles = [];
        particles = [];
        decals = [];
        traps = [];
        portals = [];
        damageText = [];
        gameOverTriggered = false;
        isTournamentMatch = false;

        const total = campaignState.roster.length + campaignLastEnemyRoster.length;
        const mapSelect = getEl('mapSizeSelect');
        if (mapSelect && total >= 12 && ['small', 'normal'].includes(mapSelect.value)) {
            mapSelect.value = total > 28 ? 'huge' : 'large';
        }
        if (typeof changeMapSize === 'function') changeMapSize();
        // changeMapSize() may rebuild normal setup squads, so clear again before campaign spawning.
        entities = [];
        projectiles = [];
        particles = [];
        decals = [];
        traps = [];
        portals = [];
        damageText = [];

        spawnCampaignTeam(campaignState.roster, 1, 'p1', '#00c3ff');
        spawnCampaignTeam(campaignLastEnemyRoster, 2, 'p2', '#ff4757');
        if (typeof randomizeObstacles === 'function' && campaignState.level >= 3 && campaignState.level % 2 === 0) randomizeObstacles();

        isSetupPhase = false;
        gameActive = true;
        battleRunId++;
        battleStartFrame = frameCount;
        battleTotalKills = 0;
        battleStats = {};
        entities.forEach(e => {
            applyBattleChaosToFighter(e);
            if (typeof ensureBattleStat === 'function') ensureBattleStat(e);
        });
        const title = getEl('mainTitle');
        if (title) title.innerHTML = `<span style="color:#00c3ff">CAMPAIGN SQUAD</span> VS <span style="color:#ff4757">LEVEL ${campaignState.level}</span>`;
        if (typeof resetCamera === 'function') resetCamera();
        if (typeof updateLiveCounts === 'function') updateLiveCounts();
        if (resultModal) resultModal.style.display = 'none';
        if (typeof playBGM === 'function') playBGM('battle');
    }
    function resolveCampaignBattle(resultTextValue) {
        if (!campaignBattleActive || campaignBattleResolved) return;
        campaignBattleResolved = true;
        campaignBattleActive = false;
        const won = String(resultTextValue || '').includes('LEFT');
        if (won) {
            const reward = 95 + campaignState.level * 28 + Math.floor(campaignLastEnemyRoster.length * 12);
            campaignState.gold += reward;
            campaignState.wins += 1;
            campaignState.lastReward = reward;
            campaignState.level += 1;
            campaignState.currentEnemy = null;
            saveCampaignState(false);
            setTimeout(() => showCustomMessage('Campaign Cleared', `Victory! Earned $${reward}. Level ${campaignState.level} unlocked.`), 450);
        } else {
            const consolation = 20 + Math.floor(campaignState.level * 4);
            campaignState.gold += consolation;
            campaignState.losses += 1;
            saveCampaignState(false);
            setTimeout(() => showCustomMessage('Campaign Defeat', `You gained $${consolation} retry money. Change your squad and try again.`), 450);
        }
        renderCampaignUI();
    }

    function showCampaignModeUI() {
        const std = getEl('standardControls');
        const tourney = getEl('tournamentControls');
        const campaign = getEl('campaignControls');
        const squad = getEl('squadSection');
        const title = getEl('mainTitle');
        const teamScore = getEl('teamScoreDisplay');
        const ffaScore = getEl('ffaScoreDisplay');
        if (std) std.style.display = 'none';
        if (tourney) tourney.style.display = 'none';
        if (campaign) campaign.style.display = 'flex';
        if (squad) squad.style.display = 'none';
        if (title) title.innerHTML = '<span style="color:#2ed573">CAMPAIGN</span> <span style="color:#f1c40f">ADVENTURE</span>';
        if (teamScore) teamScore.style.display = 'inline';
        if (ffaScore) ffaScore.style.display = 'none';
        isTournamentMatch = false;
        renderCampaignUI();
    }
    function hideCampaignModeUI() {
        const campaign = getEl('campaignControls');
        if (campaign) campaign.style.display = 'none';
    }

    window.buyCampaignFighter = buyCampaignFighter;
    window.sellCampaignFighter = sellCampaignFighter;
    window.clearCampaignRoster = clearCampaignRoster;
    window.autoBuyCampaignSquad = autoBuyCampaignSquad;
    window.rerollCampaignEnemy = rerollCampaignEnemy;
    window.startCampaignBattle = startCampaignBattle;
    window.resetCampaignRun = resetCampaignRun;
    window.saveCampaignState = saveCampaignState;

    function bootCampaignPatch() {
        populateFighterSelect('tourneyCustomFighterSelect');
        populateFighterSelect('campaignShopSelect');
        renderTournamentCustomRoster();
        renderCampaignUI();
        const shop = getEl('campaignShopSelect');
        if (shop && !shop.__campaignInfoBound) {
            shop.addEventListener('change', renderCampaignUI);
            shop.__campaignInfoBound = true;
        }
    }

    if (typeof toggleGameMode === 'function' && !toggleGameMode.__campaignWrapped) {
        const oldToggleGameMode = toggleGameMode;
        toggleGameMode = function campaignToggleGameModeWrapper() {
            const modeSelect = getEl('modeSelect');
            const chosenMode = modeSelect ? modeSelect.value : GAME_MODE;
            const result = oldToggleGameMode.apply(this, arguments);
            if (chosenMode === 'campaign') {
                GAME_MODE = 'campaign';
                isSetupPhase = true;
                showCampaignModeUI();
                if (typeof updateFullscreenHud === 'function') updateFullscreenHud();
            } else {
                hideCampaignModeUI();
            }
            return result;
        };
        toggleGameMode.__campaignWrapped = true;
        window.toggleGameMode = toggleGameMode;
    }

    if (typeof syncFullscreenSetupControls === 'function' && !syncFullscreenSetupControls.__campaignWrapped) {
        const oldSyncFs = syncFullscreenSetupControls;
        syncFullscreenSetupControls = function campaignSyncFullscreenSetupControls() {
            const fsMode = getEl('fsModeSelect');
            if (fsMode && !Array.from(fsMode.options).some(opt => opt.value === 'campaign')) {
                fsMode.insertAdjacentHTML('beforeend', '<option value="campaign">Campaign</option>');
            }
            return oldSyncFs.apply(this, arguments);
        };
        syncFullscreenSetupControls.__campaignWrapped = true;
        window.syncFullscreenSetupControls = syncFullscreenSetupControls;
    }

    if (typeof endGame === 'function' && !endGame.__campaignWrapped) {
        const oldEndGame = endGame;
        endGame = function campaignEndGameWrapper(text) {
            const wasCampaign = GAME_MODE === 'campaign' && campaignBattleActive;
            const result = oldEndGame.apply(this, arguments);
            if (wasCampaign) resolveCampaignBattle(text);
            return result;
        };
        endGame.__campaignWrapped = true;
        window.endGame = endGame;
    }

    if (typeof playAgain === 'function' && !playAgain.__campaignWrapped) {
        const oldPlayAgain = playAgain;
        playAgain = function campaignPlayAgainWrapper() {
            if (GAME_MODE === 'campaign') {
                if (resultModal) resultModal.style.display = 'none';
                startCampaignBattle();
                return;
            }
            return oldPlayAgain.apply(this, arguments);
        };
        playAgain.__campaignWrapped = true;
        window.playAgain = playAgain;
    }

    if (typeof resetPositions === 'function' && !resetPositions.__campaignWrapped) {
        const oldReset = resetPositions;
        resetPositions = function campaignResetPositionsWrapper() {
            if (GAME_MODE === 'campaign' && !campaignBattleActive) {
                entities = [];
                projectiles = [];
                particles = [];
                decals = [];
                traps = [];
                isSetupPhase = true;
                gameOverTriggered = false;
                if (typeof resetCamera === 'function') resetCamera();
                renderCampaignUI();
                return;
            }
            return oldReset.apply(this, arguments);
        };
        resetPositions.__campaignWrapped = true;
        window.resetPositions = resetPositions;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootCampaignPatch);
    } else {
        bootCampaignPatch();
    }
})();


/* --- FARREL TOURNAMENT START BUTTON + TACTICAL CHESS REVAMP --- */
(function farrelTournamentStartAndTacticalChessPatch() {
    const CHESS_STATE_KEY = 'ballBattleTacticalChessLastConfig';

    const chessState = {
        active: false,
        mode: 'classic',
        objective: 'king',
        opening: 'balanced',
        labels: true,
        control: { 1: 0, 2: 0 },
        points: [],
        lastScoreFrame: -1
    };

    function safeEl(id) {
        return document.getElementById(id);
    }

    function parseIntInput(id, fallback, min = 1, max = 10000) {
        const el = safeEl(id);
        const value = el ? parseInt(el.value, 10) : fallback;
        if (!Number.isFinite(value)) return fallback;
        return Math.max(min, Math.min(max, value));
    }

    function showMsg(title, text) {
        if (typeof showCustomMessage === 'function') showCustomMessage(title, text);
        else console.log(`${title}: ${text}`);
    }

    function legalFighterTypesForPatch() {
        if (Array.isArray(FIGHTER_OPTIONS) && FIGHTER_OPTIONS.length) return FIGHTER_OPTIONS.slice();
        return Object.keys(FIGHTER_DATA || {}).filter(type => !['mammoth_mount'].includes(type));
    }

    function randomRosterForPatch(size) {
        const options = legalFighterTypesForPatch();
        const roster = [];
        for (let i = 0; i < size; i++) {
            roster.push(options[Math.floor(Math.random() * options.length)] || 'unarmed');
        }
        return roster;
    }

    function makePatchTournamentTeam(name, roster, index, isCustom = false) {
        const safeRoster = Array.isArray(roster) && roster.length ? roster.slice() : ['unarmed'];
        return {
            id: `${isCustom ? 'custom' : 'bot'}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
            name: String(name || `Team ${index + 1}`).toUpperCase(),
            roster: safeRoster,
            color: `hsl(${(index * 137.508) % 360}, 74%, 52%)`,
            wins: 0,
            seed: index + 1,
            isCustom: !!isCustom
        };
    }

    function getPatchBracketSize() {
        const select = safeEl('tourneyBracketSize');
        return select ? parseInt(select.value, 10) || 16 : 16;
    }

    function getPatchTeamSize() {
        return parseIntInput('tourneyTeamSize', 5, 1, 30);
    }

    function getPatchSeedStyle() {
        const select = safeEl('tourneySeedStyle');
        return select ? select.value : 'shuffle';
    }

    function getPatchRuleset() {
        const select = safeEl('tourneyRuleset');
        return select ? select.value : 'balanced';
    }

    function normalizePatchTeamRoster(team, teamSize) {
        const roster = Array.isArray(team.roster) ? team.roster.filter(Boolean).slice(0, teamSize) : [];
        while (roster.length < teamSize) roster.push('unarmed');
        return { ...team, roster };
    }

    function buildPatchFirstRound(teams) {
        const matches = [];
        for (let i = 0; i < teams.length; i += 2) {
            matches.push({
                p1: teams[i],
                p2: teams[i + 1],
                winner: null,
                score: null,
                resultReason: null,
                playedMode: null
            });
        }
        return matches;
    }

    function addBotTeamsUntilFull(bracketSize, teamSize) {
        if (!Array.isArray(customTeamPool)) customTeamPool = [];

        while (customTeamPool.length < bracketSize) {
            const idx = customTeamPool.length;
            const name = typeof generateTeamName === 'function'
                ? generateTeamName()
                : `Bot Team ${idx + 1}`;

            customTeamPool.push(makePatchTournamentTeam(name, randomRosterForPatch(teamSize), idx, false));
        }
    }

    function validateTournamentPoolForStart(bracketSize, teamSize, fillMissing) {
        if (!Array.isArray(customTeamPool)) customTeamPool = [];

        if (customTeamPool.length === 0) {
            return {
                ok: false,
                title: 'No Teams',
                message: 'Add a custom team, add P1 team, add bot teams, or press Fill + Start.'
            };
        }

        if (customTeamPool.length < bracketSize && !fillMissing) {
            return {
                ok: false,
                title: 'Pool Not Full',
                message: `You have ${customTeamPool.length}/${bracketSize} teams. Add more teams or use Fill + Start to complete the bracket with bots.`
            };
        }

        const brokenTeam = customTeamPool.find(team => !team || !Array.isArray(team.roster) || team.roster.length === 0);
        if (brokenTeam) {
            return {
                ok: false,
                title: 'Invalid Team',
                message: `${brokenTeam.name || 'A team'} has no fighters. Remove it or rebuild it.`
            };
        }

        return { ok: true };
    }

    function startTournamentFromPool(fillMissing = false) {
        const bracketSize = getPatchBracketSize();
        const teamSize = getPatchTeamSize();

        const validation = validateTournamentPoolForStart(bracketSize, teamSize, fillMissing);
        if (!validation.ok) {
            showMsg(validation.title, validation.message);
            return false;
        }

        if (fillMissing) addBotTeamsUntilFull(bracketSize, teamSize);

        let teams = customTeamPool
            .slice(0, bracketSize)
            .map((team, index) => normalizePatchTeamRoster({
                ...JSON.parse(JSON.stringify(team)),
                seed: index + 1,
                color: team.color || `hsl(${(index * 137.508) % 360}, 74%, 52%)`
            }, teamSize));

        if (teams.length < bracketSize) {
            showMsg('Pool Not Full', `Only ${teams.length}/${bracketSize} teams are ready.`);
            return false;
        }

        if (getPatchSeedStyle() === 'shuffle') {
            teams.sort(() => Math.random() - 0.5);
        }

        teams.forEach((team, index) => {
            team.seed = index + 1;
            if (!team.color) team.color = `hsl(${(index * 137.508) % 360}, 74%, 52%)`;
        });

        tournamentData = {
            active: true,
            teams,
            bracketSize,
            teamSize,
            ruleset: getPatchRuleset(),
            seedStyle: getPatchSeedStyle(),
            round: 0,
            matches: [buildPatchFirstRound(teams)],
            currentMatchIndex: 0,
            champion: null,
            history: [],
            startedAt: Date.now(),
            source: fillMissing ? 'pool+bots' : 'custom-pool'
        };

        GAME_MODE = 'tournament';
        const modeSelect = safeEl('modeSelect');
        if (modeSelect) modeSelect.value = 'tournament';

        isSetupPhase = true;
        isTournamentMatch = false;
        gameOverTriggered = false;

        if (typeof window.updatePoolUI === 'function') window.updatePoolUI();
        if (typeof window.updateTournamentUI === 'function') window.updateTournamentUI();
        if (typeof window.saveTournament === 'function') window.saveTournament(false);

        const status = safeEl('tourneyStatus');
        if (status) {
            status.innerText = fillMissing
                ? `Bracket started from pool and filled with bots: ${bracketSize} teams.`
                : `Bracket started from your team pool: ${bracketSize} teams.`;
        }

        showMsg('Tournament Started', fillMissing
            ? `Your pool entered the bracket. Missing slots were filled with bots.`
            : `Your custom team pool is now the active bracket. Press Watch Next or Sim Next.`);

        if (typeof playSound === 'function') playSound('zap');
        return true;
    }

    function fillAndStartTournamentFromPool() {
        return startTournamentFromPool(true);
    }

    window.startTournamentFromPool = startTournamentFromPool;
    window.fillAndStartTournamentFromPool = fillAndStartTournamentFromPool;

    // Make old "Auto Bracket" / initTournament do the obvious thing: fill missing teams and start.
    if (typeof window.initTournament === 'function' && !window.initTournament.__farrelPoolStartWrapped) {
        const previousInitTournament = window.initTournament;
        const replacementInitTournament = function patchedInitTournament() {
            if (GAME_MODE === 'tournament' || (safeEl('modeSelect') && safeEl('modeSelect').value === 'tournament')) {
                return startTournamentFromPool(true);
            }
            return previousInitTournament.apply(this, arguments);
        };

        replacementInitTournament.__farrelPoolStartWrapped = true;
        window.initTournament = replacementInitTournament;
        try { initTournament = replacementInitTournament; } catch (err) {}
    }

    function renderTournamentStartButtonState() {
        const bracketSize = getPatchBracketSize();
        const count = Array.isArray(customTeamPool) ? customTeamPool.length : 0;
        const status = safeEl('tourneyStatus');

        if (status && GAME_MODE === 'tournament' && (!tournamentData || !tournamentData.active)) {
            status.innerText = count >= bracketSize
                ? `${count}/${bracketSize} teams ready. Press Start Pool Bracket.`
                : `${count}/${bracketSize} teams in pool. Add teams or press Fill + Start.`;
        }
    }

    const originalUpdateTournamentUI = window.updateTournamentUI;
    if (typeof originalUpdateTournamentUI === 'function' && !originalUpdateTournamentUI.__farrelPoolStartWrapped) {
        window.updateTournamentUI = function patchedUpdateTournamentUI() {
            const result = originalUpdateTournamentUI.apply(this, arguments);
            renderTournamentStartButtonState();
            return result;
        };
        window.updateTournamentUI.__farrelPoolStartWrapped = true;
        try { updateTournamentUI = window.updateTournamentUI; } catch (err) {}
    }

    // ---------------- Tactical Chess ----------------
    function chessConfig() {
        const setup = safeEl('chessSetupSelect');
        const objective = safeEl('chessObjectiveSelect');
        const opening = safeEl('chessOpeningSelect');
        const labels = safeEl('chessLabelsSelect');

        return {
            mode: setup ? setup.value : 'classic',
            objective: objective ? objective.value : 'king',
            opening: opening ? opening.value : 'balanced',
            labels: !labels || labels.value !== 'off'
        };
    }

    function saveChessConfig() {
        try {
            localStorage.setItem(CHESS_STATE_KEY, JSON.stringify(chessConfig()));
        } catch (err) {}
    }

    function loadChessConfig() {
        try {
            const raw = localStorage.getItem(CHESS_STATE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            ['chessSetupSelect', 'chessObjectiveSelect', 'chessOpeningSelect', 'chessLabelsSelect'].forEach(id => {
                const el = safeEl(id);
                if (!el) return;
                const key = id === 'chessSetupSelect' ? 'mode'
                    : id === 'chessObjectiveSelect' ? 'objective'
                    : id === 'chessOpeningSelect' ? 'opening'
                    : 'labels';
                if (saved[key] !== undefined) el.value = key === 'labels' ? (saved[key] ? 'on' : 'off') : saved[key];
            });
        } catch (err) {}
    }

    function setChessStatus(text) {
        const badge = safeEl('chessStatusBadge');
        if (badge) badge.innerText = text;
    }

    function chessObjectiveText() {
        const cfg = chessConfig();
        if (cfg.objective === 'control') {
            return 'Control Points: hold glowing center zones to score. First side to 100 control points wins. Kings still matter as powerful anchors.';
        }
        if (cfg.objective === 'hybrid') {
            return 'Hybrid War: checkmate wins instantly, but holding center zones can also win at 100 control points.';
        }
        return 'King Hunt: destroy the golden enemy king to checkmate. Center zones give small healing and pressure advantages.';
    }

    function renderTacticalChessUI() {
        saveChessConfig();
        const cfg = chessConfig();
        const info = safeEl('chessObjectiveInfo');
        if (info) {
            info.innerText = `${chessObjectiveText()} Setup: ${cfg.mode}. Opening: ${cfg.opening}.`;
        }

        const label = cfg.objective === 'king' ? 'King Hunt'
            : cfg.objective === 'control' ? 'Control Points'
            : 'Hybrid War';
        const score = `L ${Math.floor(chessState.control[1] || 0)} · R ${Math.floor(chessState.control[2] || 0)}`;
        setChessStatus(`${label} · ${score}`);
    }

    window.renderTacticalChessUI = renderTacticalChessUI;

    function chessPointList() {
        return [
            { x: canvas.width * 0.50, y: canvas.height * 0.50, r: 48, name: 'CENTER', owner: 0 },
            { x: canvas.width * 0.50, y: canvas.height * 0.30, r: 36, name: 'NORTH', owner: 0 },
            { x: canvas.width * 0.50, y: canvas.height * 0.70, r: 36, name: 'SOUTH', owner: 0 }
        ];
    }

    function resetChessRuntimeState(cfg) {
        chessState.active = true;
        chessState.mode = cfg.mode;
        chessState.objective = cfg.objective;
        chessState.opening = cfg.opening;
        chessState.labels = cfg.labels;
        chessState.control = { 1: 0, 2: 0 };
        chessState.points = chessPointList();
        chessState.lastScoreFrame = frameCount;
        renderTacticalChessUI();
    }

    function addChessObstacle(type, x, y, radius = 22, hp = 150) {
        obstacles.push({
            x, y, type,
            radius,
            hp,
            maxHp: hp,
            mass: type === 'rock' ? 3.5 : 2.0,
            vx: 0,
            vy: 0,
            friction: 0.92
        });
    }

    function applyChessBoardHazards(mode) {
        if (mode === 'fortress') {
            const rows = [0.38, 0.50, 0.62];
            rows.forEach(yMul => {
                addChessObstacle('rock', canvas.width * 0.26, canvas.height * yMul, 18, 180);
                addChessObstacle('rock', canvas.width * 0.74, canvas.height * yMul, 18, 180);
            });
            addChessObstacle('spike', canvas.width * 0.50, canvas.height * 0.18, 22, 220);
            addChessObstacle('spike', canvas.width * 0.50, canvas.height * 0.82, 22, 220);
        }

        if (mode === 'chaos') {
            addChessObstacle('barrel', canvas.width * 0.50, canvas.height * 0.18, 20, 50);
            addChessObstacle('barrel', canvas.width * 0.50, canvas.height * 0.82, 20, 50);
            addChessObstacle('ice', canvas.width * 0.50, canvas.height * 0.50, 42, 999);
            addChessObstacle('mine', canvas.width * 0.42, canvas.height * 0.35, 16, 1);
            addChessObstacle('mine', canvas.width * 0.58, canvas.height * 0.65, 16, 1);
        }
    }

    function configureChessPiece(f, role, label, team, row) {
        f.chessPiece = true;
        f.chessRole = role;
        f.chessLabel = label;
        f.chessRow = row;
        f.chessAge = 0;
        f.chessPromoted = false;
        f.displayName = `${team === 1 ? 'Left' : 'Right'} ${role}`;
        f.angle = team === 1 ? 0 : Math.PI;

        if (role === 'King') {
            f.isKing = true;
            f.maxHp *= 1.85;
            f.hp = f.maxHp;
            f.radius += 4;
            f.color = team === 1 ? '#f1c40f' : '#ffdd59';
            f.dmgMult = (f.dmgMult || 1) * 1.05;
        }

        if (role === 'Queen') {
            f.maxHp *= 1.18;
            f.hp = f.maxHp;
            f.radius += 2;
            f.dmgMult = (f.dmgMult || 1) * 1.18;
        }

        if (role === 'Pawn') {
            f.mass *= 0.82;
            f.maxHp *= 0.92;
            f.hp = f.maxHp;
        }

        if (role === 'Knight') {
            f.bravery = 1.25;
            f.dmgMult = (f.dmgMult || 1) * 1.08;
        }

        if (role === 'Rook') {
            f.maxHp *= 1.1;
            f.hp = f.maxHp;
        }

        if (role === 'Bishop') {
            f.dmgMult = (f.dmgMult || 1) * 1.08;
        }
    }

    function setupTacticalChessBoard(startNow = false) {
        const cfg = chessConfig();
        saveChessConfig();

        GAME_MODE = 'chess';
        const modeSelect = safeEl('modeSelect');
        if (modeSelect) modeSelect.value = 'chess';

        entities = [];
        projectiles = [];
        particles = [];
        decals = [];
        damageText = [];
        obstacles = [];
        pickups = [];
        battleStats = {};
        gameOverTriggered = false;
        isTournamentMatch = false;
        isSetupPhase = true;

        resetChessRuntimeState(cfg);

        const rows = cfg.mode === 'blitz' ? [1, 2, 3, 4, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
        const cellH = Math.min(56, Math.max(34, (canvas.height - 110) / 8));
        const startY = canvas.height / 2 - cellH * 3.5;

        let leftBackX = 76;
        let leftPawnX = 148;
        let rightBackX = canvas.width - 76;
        let rightPawnX = canvas.width - 148;

        if (cfg.opening === 'aggressive') {
            leftPawnX += 35;
            rightPawnX -= 35;
        }

        if (cfg.opening === 'defensive') {
            leftBackX -= 10;
            leftPawnX -= 20;
            rightBackX += 10;
            rightPawnX += 20;
        }

        const backline = [
            { type: 'laser', role: 'Rook', label: '♜' },
            { type: 'knight', role: 'Knight', label: '♞' },
            { type: 'wizard', role: 'Bishop', label: '♝' },
            { type: 'spatial', role: 'Queen', label: '♛' },
            { type: 'duplicator', role: 'King', label: '♚' },
            { type: 'wizard', role: 'Bishop', label: '♝' },
            { type: 'knight', role: 'Knight', label: '♞' },
            { type: 'laser', role: 'Rook', label: '♜' }
        ];

        function spawnPiece(piece, row, team, isPawn) {
            const y = startY + row * cellH;
            const x = team === 1
                ? (isPawn ? leftPawnX : leftBackX)
                : (isPawn ? rightPawnX : rightBackX);

            const f = createFighter(piece.type, x, y, team);
            configureChessPiece(f, piece.role, piece.label, team, row);
            f.initialX = x;
            f.initialY = y;
            entities.push(f);
            return f;
        }

        [1, 2].forEach(team => {
            rows.forEach(row => {
                spawnPiece({ type: 'unarmed', role: 'Pawn', label: '♟' }, row, team, true);
            });

            rows.forEach(row => {
                const piece = backline[row];
                if (piece) spawnPiece(piece, row, team, false);
            });
        });

        applyChessBoardHazards(cfg.mode);

        updateLiveCounts();
        if (typeof resetCamera === 'function') resetCamera();
        if (!gameActive && typeof loop === 'function') {
            gameActive = true;
            loop();
        }

        if (startNow) beginBattle();
    }

    function startTacticalChess() {
        setupTacticalChessBoard(false);
        beginBattle();
        showMsg('Tactical Chess', 'Battle started. Protect your king and control the center.');
    }

    function resetTacticalChessBoard() {
        setupTacticalChessBoard(false);
        showMsg('Tactical Chess', 'Board reset. Press Start Tactical Chess when ready.');
    }

    function previewTacticalChessBoard() {
        setupTacticalChessBoard(false);
        showMsg('Chess Preview', chessObjectiveText());
    }

    function explainTacticalChess() {
        showMsg('Tactical Chess Rules', 'Checkmate the enemy king. Pawns promote after crossing the center. Control points heal and score. Fortress and Chaos boards add terrain, mines, barrels, and ice.');
    }

    window.startTacticalChess = startTacticalChess;
    window.resetTacticalChessBoard = resetTacticalChessBoard;
    window.previewTacticalChessBoard = previewTacticalChessBoard;
    window.explainTacticalChess = explainTacticalChess;

    if (typeof initializeSquads === 'function' && !initializeSquads.__farrelChessRevampWrapped) {
        const previousInitializeSquads = initializeSquads;
        initializeSquads = function patchedInitializeSquads() {
            if (GAME_MODE === 'chess') {
                setupTacticalChessBoard(false);
                return;
            }
            return previousInitializeSquads.apply(this, arguments);
        };
        initializeSquads.__farrelChessRevampWrapped = true;
        window.initializeSquads = initializeSquads;
    }

    function liveChessPieces() {
        return entities.filter(e => e && e.hp > 0 && e.chessPiece);
    }

    function findChessKings() {
        return liveChessPieces().filter(e => e.isKing);
    }

    function promotePawn(e) {
        if (!e || e.chessPromoted || e.chessRole !== 'Pawn') return;

        const crossed = e.team === 1
            ? e.x > canvas.width * 0.56
            : e.x < canvas.width * 0.44;

        const survivedLong = e.chessAge > 60 * 35;

        if (!crossed && !survivedLong) return;

        e.chessPromoted = true;
        e.chessRole = 'Promoted Knight';
        e.chessLabel = '♞';
        e.type = 'knight';
        e.originalType = 'knight';
        e.displayName = `${e.team === 1 ? 'Left' : 'Right'} Promoted Knight`;
        e.maxHp += 80;
        e.hp = Math.min(e.maxHp, e.hp + 80);
        e.radius += 2;
        e.dmgMult = (e.dmgMult || 1) * 1.3;
        e.bravery = 1.45;
        spawnParticles(e.x, e.y, '#f1c40f', 22);
        spawnDamageText(e.x, e.y - 30, 'PROMOTED', '#f1c40f', true);
    }

    function applyKingAuras() {
        const kings = findChessKings();
        kings.forEach(king => {
            liveChessPieces().forEach(piece => {
                if (piece.team !== king.team || piece.id === king.id) return;
                const d = Math.hypot(piece.x - king.x, piece.y - king.y);
                if (d > 145) return;

                piece.chessGuardTimer = 12;

                if (!isSetupPhase && frameCount % 60 === 0) {
                    piece.hp = Math.min(piece.maxHp, piece.hp + 1.5);
                    if (Math.random() < 0.35) spawnParticles(piece.x, piece.y, '#f1c40f', 1);
                }
            });
        });
    }

    function applyControlPointRules() {
        if (!chessState.points.length) chessState.points = chessPointList();

        chessState.points.forEach(point => {
            let left = 0;
            let right = 0;

            liveChessPieces().forEach(piece => {
                const d = Math.hypot(piece.x - point.x, piece.y - point.y);
                if (d > point.r + piece.radius) return;
                if (piece.team === 1) left++;
                if (piece.team === 2) right++;
            });

            point.owner = left > right ? 1 : right > left ? 2 : point.owner || 0;

            if (!isSetupPhase && point.owner && frameCount % 30 === 0) {
                chessState.control[point.owner] = (chessState.control[point.owner] || 0) + (point.name === 'CENTER' ? 2 : 1);

                liveChessPieces().forEach(piece => {
                    if (piece.team !== point.owner) return;
                    const d = Math.hypot(piece.x - point.x, piece.y - point.y);
                    if (d < point.r + 55) {
                        piece.hp = Math.min(piece.maxHp, piece.hp + 0.8);
                        piece.chessPointTimer = 18;
                    }
                });
            }
        });

        const canControlWin = chessState.objective === 'control' || chessState.objective === 'hybrid';
        if (canControlWin && !gameOverTriggered && !isSetupPhase) {
            if ((chessState.control[1] || 0) >= 100) endGame('LEFT TEAM WINS BY CONTROL');
            if ((chessState.control[2] || 0) >= 100) endGame('RIGHT TEAM WINS BY CONTROL');
        }
    }

    function applyTacticalChessRules() {
        if (GAME_MODE !== 'chess' || !chessState.active) return;

        liveChessPieces().forEach(piece => {
            piece.chessAge = (piece.chessAge || 0) + 1;

            if (piece.chessRole === 'Pawn') promotePawn(piece);

            if (piece.chessGuardTimer > 0) piece.chessGuardTimer--;
            if (piece.chessPointTimer > 0) piece.chessPointTimer--;
        });

        applyKingAuras();
        applyControlPointRules();

        if (frameCount % 15 === 0) renderTacticalChessUI();
    }

    if (typeof update === 'function' && !update.__farrelChessRevampWrapped) {
        const previousUpdate = update;
        update = function patchedUpdate() {
            const result = previousUpdate.apply(this, arguments);
            applyTacticalChessRules();
            return result;
        };
        update.__farrelChessRevampWrapped = true;
        window.update = update;
    }

    function drawChessWorldOverlay() {
        if (GAME_MODE !== 'chess' || !chessState.active) return;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        const cols = 8;
        const rows = 8;
        const minX = canvas.width * 0.16;
        const maxX = canvas.width * 0.84;
        const minY = canvas.height * 0.10;
        const maxY = canvas.height * 0.90;
        const cellW = (maxX - minX) / cols;
        const cellH = (maxY - minY) / rows;

        ctx.save();
        ctx.globalAlpha = 0.18;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
                ctx.fillRect(minX + c * cellW, minY + r * cellH, cellW, cellH);
            }
        }
        ctx.restore();

        chessState.points.forEach(point => {
            const ownerColor = point.owner === 1 ? '#00c3ff' : point.owner === 2 ? '#d62626' : '#f1c40f';
            ctx.save();
            ctx.globalAlpha = 0.25 + 0.08 * Math.sin(frameCount * 0.08);
            ctx.fillStyle = ownerColor;
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = ownerColor;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = ownerColor;
            ctx.font = '900 12px "Segoe UI", Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(point.name, point.x, point.y);
            ctx.restore();
        });

        if (chessState.labels) {
            liveChessPieces().forEach(piece => {
                ctx.save();
                ctx.font = '900 18px "Segoe UI Symbol", "Arial", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'rgba(0,0,0,.85)';
                ctx.fillStyle = piece.isKing ? '#f1c40f' : '#ffffff';
                const label = piece.chessLabel || '?';
                ctx.strokeText(label, piece.x, piece.y - piece.radius - 14);
                ctx.fillText(label, piece.x, piece.y - piece.radius - 14);

                if (piece.chessGuardTimer > 0 || piece.chessPointTimer > 0) {
                    ctx.globalAlpha = 0.4;
                    ctx.strokeStyle = piece.chessGuardTimer > 0 ? '#f1c40f' : '#2ed573';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(piece.x, piece.y, piece.radius + 8, 0, Math.PI * 2);
                    ctx.stroke();
                }

                if (piece.isKing) {
                    ctx.globalAlpha = 0.18;
                    ctx.strokeStyle = '#f1c40f';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(piece.x, piece.y, 145, 0, Math.PI * 2);
                    ctx.stroke();
                }

                ctx.restore();
            });
        }

        ctx.restore();
    }

    function drawChessScreenHud() {
        if (GAME_MODE !== 'chess' || !chessState.active) return;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const w = 250;
        const h = 58;
        const x = 12;
        const y = 12;

        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = '#f1c40f';
        ctx.font = '900 13px "Segoe UI", Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('TACTICAL CHESS', x + 10, y + 8);

        ctx.fillStyle = '#fff';
        ctx.font = '800 12px "Segoe UI", Arial';
        const mode = chessState.objective === 'control' ? 'Control' : chessState.objective === 'hybrid' ? 'Hybrid' : 'King Hunt';
        ctx.fillText(`${mode} · L ${Math.floor(chessState.control[1] || 0)} | R ${Math.floor(chessState.control[2] || 0)}`, x + 10, y + 30);

        ctx.restore();
    }

    if (typeof draw === 'function' && !draw.__farrelChessRevampWrapped) {
        const previousDraw = draw;
        draw = function patchedDraw() {
            const result = previousDraw.apply(this, arguments);
            drawChessWorldOverlay();
            drawChessScreenHud();
            return result;
        };
        draw.__farrelChessRevampWrapped = true;
        window.draw = draw;
    }

    function showChessModeUI() {
        const chess = safeEl('chessControls');
        const standard = safeEl('standardControls');
        const tournament = safeEl('tournamentControls');
        const campaign = safeEl('campaignControls');
        const squad = document.querySelector('.squad-section');
        const title = safeEl('mainTitle');
        const teamScore = safeEl('teamScoreDisplay');
        const ffaScore = safeEl('ffaScoreDisplay');

        if (chess) chess.style.display = 'flex';
        if (standard) standard.style.display = 'none';
        if (tournament) tournament.style.display = 'none';
        if (campaign) campaign.style.display = 'none';
        if (squad) squad.style.display = 'none';
        if (title) title.innerHTML = '<span style="color:#6c5ce7">TACTICAL</span> <span style="color:#f1c40f">CHESS</span>';
        if (teamScore) teamScore.style.display = 'inline';
        if (ffaScore) ffaScore.style.display = 'none';

        isTournamentMatch = false;
        isSetupPhase = true;
        renderTacticalChessUI();
    }

    function hideChessModeUI() {
        const chess = safeEl('chessControls');
        if (chess) chess.style.display = 'none';
    }

    if (typeof toggleGameMode === 'function' && !toggleGameMode.__farrelChessRevampWrapped) {
        const previousToggleGameMode = toggleGameMode;
        toggleGameMode = function patchedToggleGameMode() {
            const modeSelect = safeEl('modeSelect');
            const chosen = modeSelect ? modeSelect.value : GAME_MODE;
            const result = previousToggleGameMode.apply(this, arguments);

            if (chosen === 'chess') {
                GAME_MODE = 'chess';
                showChessModeUI();
                if (!chessState.active || !entities.some(e => e.chessPiece)) {
                    setupTacticalChessBoard(false);
                }
            } else {
                hideChessModeUI();
            }

            return result;
        };
        toggleGameMode.__farrelChessRevampWrapped = true;
        window.toggleGameMode = toggleGameMode;
    }

    if (typeof syncFullscreenSetupControls === 'function' && !syncFullscreenSetupControls.__farrelChessRevampWrapped) {
        const previousSyncFullscreen = syncFullscreenSetupControls;
        syncFullscreenSetupControls = function patchedSyncFullscreenSetupControls() {
            const fsMode = safeEl('fsModeSelect');
            if (fsMode && !Array.from(fsMode.options).some(opt => opt.value === 'chess')) {
                fsMode.insertAdjacentHTML('beforeend', '<option value="chess">Tactical Chess</option>');
            }
            return previousSyncFullscreen.apply(this, arguments);
        };
        syncFullscreenSetupControls.__farrelChessRevampWrapped = true;
        window.syncFullscreenSetupControls = syncFullscreenSetupControls;
    }

    function bootFarrelTournamentChessPatch() {
        loadChessConfig();
        renderTacticalChessUI();
        if (typeof window.updateTournamentUI === 'function') window.updateTournamentUI();

        const modeSelect = safeEl('modeSelect');
        if (modeSelect && modeSelect.value === 'chess') showChessModeUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFarrelTournamentChessPatch);
    } else {
        bootFarrelTournamentChessPatch();
    }
})();


/* --- FARREL TOURNAMENT COUNTER DUPLICATE-ID CLEANUP --- */
(function farrelTournamentCounterCleanup() {
    function syncAllTournamentCounters() {
        const bracket = document.getElementById('tourneyBracketSize');
        const bracketSize = bracket ? parseInt(bracket.value, 10) || 16 : 16;
        const count = Array.isArray(customTeamPool) ? customTeamPool.length : 0;
        const text = `${count}/${bracketSize}`;

        const full = document.getElementById('poolCounter');
        const mini = document.getElementById('poolCounterMini');
        if (full) full.innerText = text;
        if (mini) mini.innerText = text;
    }

    if (typeof window.updatePoolUI === 'function' && !window.updatePoolUI.__farrelCounterCleanupWrapped) {
        const oldUpdatePoolUI = window.updatePoolUI;
        window.updatePoolUI = function patchedCounterUpdatePoolUI() {
            const result = oldUpdatePoolUI.apply(this, arguments);
            syncAllTournamentCounters();
            return result;
        };
        window.updatePoolUI.__farrelCounterCleanupWrapped = true;
        try { updatePoolUI = window.updatePoolUI; } catch (err) {}
    }

    if (typeof window.updateTournamentUI === 'function' && !window.updateTournamentUI.__farrelCounterCleanupWrapped) {
        const oldUpdateTournamentUI = window.updateTournamentUI;
        window.updateTournamentUI = function patchedCounterUpdateTournamentUI() {
            const result = oldUpdateTournamentUI.apply(this, arguments);
            syncAllTournamentCounters();
            return result;
        };
        window.updateTournamentUI.__farrelCounterCleanupWrapped = true;
        try { updateTournamentUI = window.updateTournamentUI; } catch (err) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncAllTournamentCounters);
    } else {
        syncAllTournamentCounters();
    }
})();



function exitTacticalChessMode() {
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) modeSelect.value = 'team';

    try {
        GAME_MODE = 'team';
    } catch (err) {
        // Ignore if GAME_MODE is not writable in this browser context.
    }

    if (typeof toggleGameMode === 'function') toggleGameMode();
    if (typeof showRow === 'function') showRow(1);

    const panel = document.getElementById('controlsPanel');
    if (panel) panel.classList.remove('chess-mode-active');
}
window.exitTacticalChessMode = exitTacticalChessMode;

// --- FARREL PATCH: TACTICAL CHESS SCROLL MODE SYNC ---
(function () {
    function syncTacticalChessScrollMode() {
        const panel = document.getElementById('controlsPanel');
        const chess = document.getElementById('chessControls');
        const modeSelect = document.getElementById('modeSelect');

        if (!panel || !chess) return;

        let modeIsChess = false;
        try {
            modeIsChess = (typeof GAME_MODE !== 'undefined' && GAME_MODE === 'chess');
        } catch (err) {
            modeIsChess = false;
        }

        const selectIsChess = !!(modeSelect && modeSelect.value === 'chess');
        const chessIsVisible = chess.style.display && chess.style.display !== 'none';

        panel.classList.toggle('chess-mode-active', modeIsChess || selectIsChess || chessIsVisible);

        if (modeIsChess || selectIsChess || chessIsVisible) {
            chess.scrollTop = Math.min(chess.scrollTop, Math.max(0, chess.scrollHeight - chess.clientHeight));
        }
    }

    function wrapFunctionOnce(name, marker) {
        if (typeof window[name] !== 'function') return;
        if (window[name][marker]) return;

        const oldFn = window[name];
        const wrapped = function () {
            const result = oldFn.apply(this, arguments);
            setTimeout(syncTacticalChessScrollMode, 0);
            return result;
        };

        wrapped[marker] = true;
        window[name] = wrapped;

        try {
            if (name === 'toggleGameMode') toggleGameMode = wrapped;
            if (name === 'showRow') showRow = wrapped;
        } catch (err) {
            // Some browsers may not allow rebinding; window assignment still works for inline handlers.
        }
    }

    wrapFunctionOnce('toggleGameMode', '__farrelChessScrollWrapped');
    wrapFunctionOnce('showRow', '__farrelChessScrollWrapped');

    document.addEventListener('DOMContentLoaded', syncTacticalChessScrollMode);
    window.addEventListener('load', syncTacticalChessScrollMode);

    // Keep the class accurate even when older code changes display styles directly.
    setTimeout(syncTacticalChessScrollMode, 0);
    setInterval(syncTacticalChessScrollMode, 600);
})();
