//@ts-check
import BasePlugin from "./base-plugin.js";
import { default as PlaytimeServiceAPI, TIME_IS_UNKNOWN } from "./playtime-service-api.js";

const SQUAD_GAME_ID = 393380;

export default class FightersPlaytime extends BasePlugin {
  static get description() {
    return "The plugin that shows times of players";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      playtime_service_api_url: {
        required: true,
        description: "URL to Playtime Service API",
        default: "",
      },
      playtime_service_api_secret_key: {
        required: true,
        description: "Secret key for Playtime Service API",
        default: "",
      },
      commands_to_show_my_squad_leader_playtime: {
        required: false,
        description: "The list of commands to show playtime of squad leader",
        default: ["sltime", "sl", "сл", "сквадной"],
      },
      commands_to_show_all_squad_leaders_playtimes: {
        required: false,
        description: "The list of commands to show playtime of squad leader",
        default: ["slstimes", "sls", "слс", "всесл"],
      },
      commands_to_show_squadmates_playtimes: {
        required: false,
        description: "The list of commands to show playtime of squadmates",
        default: ["sm", "squadmates", "товарищи", "бойцы", "см"],
      },
      show_playtime_of_new_fighters_to_squad_leader: {
        required: false,
        description: "Whether to show playtime of new fighters to squad leader",
        default: true,
      },
      show_playtime_of_squad_leader_to_new_fighter: {
        required: false,
        description: "Whether to show playtime of squad leader to fighter on join to squad",
        default: true,
      },
      timeout_before_show_playtime_to_leader: {
        required: false,
        description: "How long after the start of the match should the time of the incoming players be shown?",
        default: 220,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.playtimeAPI = new PlaytimeServiceAPI(
      this.options.playtime_service_api_url,
      this.options.playtime_service_api_secret_key,
      SQUAD_GAME_ID
    );

    this.lastGameDate = 0;

    this.showPlaytimeToSquadLeader = this.showPlaytimeToSquadLeader.bind(this);
    this.showPlaytimeOfPlayerToPlayer = this.showPlaytimeOfPlayerToPlayer.bind(this);
    this.showPlaytimeOfAllSquadLeaders = this.showPlaytimeOfAllSquadLeaders.bind(this);
    this.showPlaytimeOfSquadmates = this.showPlaytimeOfSquadmates.bind(this);
    this.showPlaytimeOfSpecificSquadLeader = this.showPlaytimeOfSpecificSquadLeader.bind(this);
    this.showPlaytimeOfSquadToPlayer = this.showPlaytimeOfSquadToPlayer.bind(this);
    this.warn = this.warn.bind(this);
  }

  async mount() {
    this.server.on("PLAYER_SQUAD_CHANGE", async (data) => {
      if (data.player.squadID && !data.player.isLeader) {
        if (
          this.options.show_playtime_of_new_fighters_to_squad_leader &&
          this.getSecondsFromLastMatch() > this.options.timeout_before_show_playtime_to_leader
        ) {
          await this.showPlaytimeToSquadLeader(data.player);
        }

        if (this.options.show_playtime_of_squad_leader_to_new_fighter) {
          await this.showPlaytimeOfSpecificSquadLeader(data.player, data.player.squadID);
        }
      }
    });

    for (const command of this.options.commands_to_show_my_squad_leader_playtime) {
      this.server.on(`CHAT_COMMAND:${command}`, async (data) => {
        let squadID = parseInt(data.message);
        if (data.player && squadID) {
          await this.showPlaytimeOfSpecificSquadLeader(data.player, squadID);
          return;
        }

        if (data.player?.squadID) {
          await this.showPlaytimeOfSpecificSquadLeader(data.player, data.player.squadID);
        }
      });
    }

    for (const command of this.options.commands_to_show_all_squad_leaders_playtimes) {
      this.server.on(`CHAT_COMMAND:${command}`, async (data) => {
        if (data?.player) {
          await this.showPlaytimeOfAllSquadLeaders(data.player);
        }
      });
    }

    for (const command of this.options.commands_to_show_squadmates_playtimes) {
      this.server.on(`CHAT_COMMAND:${command}`, (data) => {
        if (data?.player?.squadID) {
          this.showPlaytimeOfSquadmates(data.player);
        }
      });
    }

    this.server.on("NEW_GAME", () => (this.lastGameDate = Date.now()));
  }

  /**
   * Показывает количество часов определенного отдельного игрока
   *
   * @param {*} showPlayer
   * @param {*} toPlayer
   * @param {*} whetherToShowUnknown
   * @param {number} repeat
   * @returns
   */
  async showPlaytimeOfPlayerToPlayer(showPlayer, toPlayer, whetherToShowUnknown = false, repeat = 2) {
    let playtime = await this.getPlayerPlaytime(showPlayer.steamID);

    if (playtime === TIME_IS_UNKNOWN) {
      if (whetherToShowUnknown) {
        await this.warn(toPlayer.steamID, `Время ${showPlayer.name} - неизвестно`);
      }
      return;
    }

    if (showPlayer.isLeader) {
      await this.warn(toPlayer.steamID, `У сквадного ${showPlayer.name} - ${playtime.toFixed(0)} часов`, repeat);
    } else {
      await this.warn(toPlayer.steamID, `У ${showPlayer.name} - ${playtime.toFixed(0)} часов`, repeat);
    }
  }

  /**
   * Показывает количество часов определенного сквадного и его бойцов
   *
   * @param {*} leader
   * @param {*} toPlayer
   * @param {number} repeat
   */
  async showPlaytimeOfSquadToPlayer(leader, toPlayer, repeat = 2) {
    let squadMates = this.server.players.filter(
      (player) => player.teamID === leader.teamID && player.squadID === leader.squadID && !player.isLeader
    );

    let squadMatesText = "";
    if (squadMates.length > 0) {
      const squadMatesPlaytime = await this.getPlayersTotalPlaytime(squadMates.map((player) => player.steamID));
      squadMatesText = `\nПехота - суммарно ${squadMatesPlaytime !== TIME_IS_UNKNOWN ? squadMatesPlaytime.toFixed(0) : "неизвестное количество"} часов`;
    }

    const leaderPlaytime = await this.getPlayerPlaytime(leader.steamID);

    await this.warn(
      toPlayer.steamID,
      `Отряд №${leader.squadID}:\nСквадной ${leader.name} - ${leaderPlaytime !== TIME_IS_UNKNOWN ? leaderPlaytime.toFixed(0) : "неизвестное количество"} часов${squadMatesText}`,
      repeat
    );
  }

  /**
   * Показать время бойца его сквадному
   *
   * @param {*} squadPlayer
   * @returns
   */
  async showPlaytimeToSquadLeader(squadPlayer) {
    let leader = this.server.players.find(
      (player) => player.isLeader && player.squadID === squadPlayer.squadID && player.teamID === squadPlayer.teamID
    );

    if (leader === undefined) {
      return;
    }

    this.showPlaytimeOfPlayerToPlayer(squadPlayer, leader, true, 1);
  }

  async showPlaytimeOfAllSquadLeaders(squadPlayer) {
    let squadLeaders = this.server.players.filter((player) => player.isLeader && player.teamID === squadPlayer.teamID);

    for (const leader of squadLeaders) {
      await this.showPlaytimeOfSquadToPlayer(leader, squadPlayer, 1);
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    }
  }

  /**
   * Показывает игроку время определенного сквада
   *
   * @param {*} squadPlayer
   * @param {number} squadID
   * @returns
   */
  async showPlaytimeOfSpecificSquadLeader(squadPlayer, squadID) {
    let squadLeader = this.server.players.find(
      (player) => player.isLeader && player.teamID === squadPlayer.teamID && player.squadID === squadID
    );

    if (!squadLeader) {
      await this.warn(squadPlayer.steamID, "Сквад с таким номером не найден");
      return;
    }

    await this.showPlaytimeOfSquadToPlayer(squadLeader, squadPlayer, 1);
  }

  /**
   * Показывает игроку время бойцов его отряда
   *
   * @param {*} squadPlayer
   */
  async showPlaytimeOfSquadmates(squadPlayer) {
    let squadMates = this.server.players.filter(
      (player) => player.teamID === squadPlayer.teamID && player.squadID === squadPlayer.squadID
    );

    for (const squadMate of squadMates) {
      await this.showPlaytimeOfPlayerToPlayer(squadMate, squadPlayer, true, 1);
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    }
  }

  /**
   * Получение времени определенного игрока
   *
   * @param {string} steamID
   * @param {*} isNeedUpdate
   * @returns {Promise<number | TIME_IS_UNKNOWN>}
   */
  async getPlayerPlaytime(steamID, isNeedUpdate = false) {
    try {
      const playtime = await this.playtimeAPI.getPlayerMaxSecondsPlaytime(steamID, isNeedUpdate);
      if (playtime === TIME_IS_UNKNOWN) {
        return playtime;
      }

      return playtime / 60 / 60;
    } catch (error) {
      this.verbose(1, `Failed to get playtime for ${steamID} with error: ${error}`);
      return TIME_IS_UNKNOWN;
    }
  }

  /**
   *
   * @param {Array<string>} steamIDs
   * @param {boolean} isNeedUpdate
   * @returns {Promise<number | TIME_IS_UNKNOWN>}
   */
  async getPlayersTotalPlaytime(steamIDs, isNeedUpdate = false) {
    if (steamIDs.length === 0) {
      this.verbose("WARNING: steamIDs length in getPlayersTotalPlaytime === 0");
      return TIME_IS_UNKNOWN;
    }

    try {
      return (await this.playtimeAPI.getPlayersTotalSecondsPlaytime(steamIDs, isNeedUpdate)) / 60 / 60;
    } catch (error) {
      this.verbose(1, `Failed to get playtimes for ${steamIDs.length} steam ids with error: ${error}`);
      return TIME_IS_UNKNOWN;
    }
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }

  getSecondsFromLastMatch() {
    return (Date.now() - this.lastGameDate) / 1000;
  }
}
