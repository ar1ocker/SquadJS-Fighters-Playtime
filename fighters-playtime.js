import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";

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
      steam_key: {
        required: true,
        description: "The steam api key",
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
        default: ["sm", "squadmates", "товарищи", "бойцы"],
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
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.steam_api = new PlaytimeSearcher(this.options.steam_key);

    this.showPlaytimeToSquadLeader = this.showPlaytimeToSquadLeader.bind(this);
    this.showPlaytimeOfPlayerToPlayer = this.showPlaytimeOfPlayerToPlayer.bind(this);
    this.showPlaytimeOfSquadLeader = this.showPlaytimeOfSquadLeader.bind(this);
    this.showPlaytimeOfAllSquadLeaders = this.showPlaytimeOfAllSquadLeaders.bind(this);
    this.showPlaytimeOfSquadmates = this.showPlaytimeOfSquadmates.bind(this);
    this.showPlaytimeOfSpecificSquadLeader = this.showPlaytimeOfSpecificSquadLeader.bind(this);
    this.warn = this.warn.bind(this);
  }

  async mount() {
    this.server.on("PLAYER_SQUAD_CHANGE", async (data) => {
      if (data.player.squadID && !data.player.isLeader) {
        if (this.options.show_playtime_of_new_fighters_to_squad_leader) {
          await this.showPlaytimeToSquadLeader(data.player);
        }

        if (this.options.show_playtime_of_squad_leader_to_new_fighter) {
          await this.showPlaytimeOfSquadLeader(data.player);
        }
      }
    });

    for (const command of this.options.commands_to_show_my_squad_leader_playtime) {
      this.server.on(`CHAT_COMMAND:${command}`, async (data) => {
        let squadID = parseInt(data.message);
        if (data?.player && squadID) {
          await this.showPlaytimeOfSpecificSquadLeader(data.player, squadID);
          return;
        }
        if (data?.player?.squadID) {
          await this.showPlaytimeOfSquadLeader(data.player);
        }
      });
    }

    for (const command of this.options.commands_to_show_all_squad_leaders_playtimes) {
      this.server.on(`CHAT_COMMAND:${command}`, async (data) => {
        if (data?.player) {
          await this.showPlaytimeOfAllSquadLeaders(data.player);
        }
      });

      for (const command of this.options.commands_to_show_squadmates_playtimes) {
        this.server.on(`CHAT_COMMAND:${command}`, async (data) => {
          if (data?.player?.squadID) {
            await this.showPlaytimeOfSquadmates(data.player);
          }
        });
      }
    }
  }

  async showPlaytimeOfPlayerToPlayer(showPlayer, toPlayer, whetherToShowUnknown = false, repeat = 2) {
    let playtimeObj = await this.steam_api.getPlaytimeByGame(showPlayer.steamID, SQUAD_GAME_ID);

    if (playtimeObj.playtime === TIME_IS_UNKNOWN) {
      if (whetherToShowUnknown) {
        await this.warn(toPlayer.steamID, `Время ${showPlayer.name} - неизвестно`);
      }
      return;
    }

    if (showPlayer.isLeader) {
      await this.warn(
        toPlayer.steamID,
        `У сквадного ${showPlayer.name} - ${playtimeObj.playtime.toFixed(0)} часов`,
        repeat
      );
    } else {
      await this.warn(toPlayer.steamID, `У ${showPlayer.name} - ${playtimeObj.playtime.toFixed(0)} часов`, repeat);
    }
  }

  async showPlaytimeToSquadLeader(squadPlayer) {
    let leader = await this.server.players.find(
      (player) => player.isLeader && player.squadID === squadPlayer.squadID && player.teamID === squadPlayer.teamID
    );

    if (leader === undefined) {
      return;
    }

    this.showPlaytimeOfPlayerToPlayer(squadPlayer, leader);
  }

  async showPlaytimeOfSquadLeader(squadPlayer) {
    let leader = await this.server.players.find(
      (player) => player.isLeader && player.squadID === squadPlayer.squadID && player.teamID === squadPlayer.teamID
    );

    if (leader === undefined) {
      return;
    }

    this.showPlaytimeOfPlayerToPlayer(leader, squadPlayer, true);
  }

  async showPlaytimeOfAllSquadLeaders(squadPlayer) {
    let squadLeaders = await this.server.players.filter(
      (player) => player.isLeader && player.teamID === squadPlayer.teamID
    );

    for (const leader of squadLeaders) {
      await this.showPlaytimeOfPlayerToPlayer(leader, squadPlayer, true, 1);
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    }
  }

  async showPlaytimeOfSpecificSquadLeader(squadPlayer, squadID) {
    let squadLeader = await this.server.players.find(
      (player) => player.isLeader && player.teamID === squadPlayer.teamID && player.squadID === squadID
    );

    if (!squadLeader) {
      await this.warn(squadPlayer.steamID, "Сквадной с таким номером не найден");
      return;
    }

    await this.showPlaytimeOfPlayerToPlayer(squadLeader, squadPlayer, true, 2);
  }

  async showPlaytimeOfSquadmates(squadPlayer) {
    let squadMates = await this.server.players.filter(
      (player) => player.teamID === squadPlayer.teamID && player.squadID === squadPlayer.squadID
    );

    for (const squadMate of squadMates) {
      await this.showPlaytimeOfPlayerToPlayer(squadMate, squadPlayer, true, 1);
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
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
}
