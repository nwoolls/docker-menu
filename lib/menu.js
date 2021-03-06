'use strict'

const Lo = require('lodash')
const app = require('app')
const path = require('path')
const Menu = require('menu')
const MenuItem = require('menu-item')
const Dialog = require('./dialog')
const Promise = require('bluebird')
const Docker = require('./docker')
const Config = require('./config')

const UPDATE_INTERVAL = 1000 * 60 * 15 // every 15 minutes
const IMAGES_FOLDER = path.resolve(app.getAppPath(), 'images')
var updateTimer, trayIcon

let statusIcon = function (bool, successIcon, failureIcon) {
  return IMAGES_FOLDER + '/' + (bool ? successIcon : failureIcon) + '.png'
}

let buildMainMenu = Promise.coroutine(function *() {
  let menu = new Menu()
  let machines = yield Docker.machines()
  let selectedMachine = Lo.find(machines, 'NAME', Config.get('selected_machine'))
  selectedMachine.isSelected = true

  if (selectedMachine) {
    yield buildContainersMenu(menu, selectedMachine)
    menu.append(new MenuItem({ type: 'separator' }))
  }

  yield buildMachinesMenu(menu, machines)
  menu.append(new MenuItem({ type: 'separator' }))

  menu.append(new MenuItem({ type: 'separator' }))
  menu.append(yield buildSwitchMenu(machines, selectedMachine))
  menu.append(new MenuItem({
    label: 'Refresh',
    click: rebuildNow
  }))
  menu.append(new MenuItem({
    label: 'Quit',
    click: app.quit
  }))

  trayIcon.setImage(statusIcon(selectedMachine.isRunning, 'menuActive', 'menuTemplate'))
  trayIcon.setContextMenu(menu)
})

let buildSwitchMenu = Promise.coroutine(function *(machines, selectedMachine) {
  let menu = new Menu()
  for (let machine of machines) {
    let selected = machine.NAME === selectedMachine.NAME
    menu.append(new MenuItem({
      label: machine.NAME,
      checked: selected,
      enabled: !selected,
      click: function () {
        Config.set('selected_machine', machine.NAME)
        rebuildNow()
      }
    }))
  }

  return new MenuItem({
    label: 'Select Machine',
    submenu: menu
  })
})

let buildMachinesMenu = Promise.coroutine(function *(menu, machines) {
  menu.append(new MenuItem({
    label: 'Machines',
    enabled: false
  }))
  for (let machine of machines) {
    let machineMenu = yield buildMachineMenu(machine)
    menu.append(machineMenu)
  }
})

let buildMachineMenu = Promise.coroutine(function *(machine) {
  return new MenuItem({
    label: machine.NAME,
    icon: statusIcon(machine.isRunning, 'circleGreen', 'circleRed'),
    click: function () {
      Dialog.showMachineActions(machine)
    }
  })
})

let buildContainersMenu = Promise.coroutine(function *(menu, machine) {
  if (machine.isRunning) {
    let docker = yield Docker.connect(machine)
    let containers = yield docker.listContainersAsync({ all: true })
    menu.append(new MenuItem({
      label: 'Containers (' + machine.NAME + ')',
      enabled: false
    }))
    for (let container of containers) {
      let containerMenu = yield buildContainerMenu(machine, container)
      menu.append(containerMenu)
    }
    if (containers.length > 0) {
      menu.append(new MenuItem({
        label: 'All...',
        click: function () {
          Dialog.showAllContainerActions(machine, containers)
        }
      }))
    }
  }
})

let buildContainerMenu = Promise.coroutine(function *(machine, container) {
  container.bestName = Lo.min(container.Names, 'length').replace(/^\//, '')
  container.isRunning = !!container.Status.match(/^(running|up)/i)
  return new MenuItem({
    label: container.bestName,
    icon: statusIcon(container.isRunning, 'boxGreen', 'boxRed'),
    click: function () {
      Dialog.showContainerActions(machine, container)
    }
  })
})

let rebuildNow = function () {
  setTimeout(buildMainMenu, 0)
}

exports.rebuildNow = rebuildNow

exports.watch = function (_trayIcon) {
  trayIcon = _trayIcon

  clearInterval(updateTimer)
  updateTimer = setInterval(buildMainMenu, UPDATE_INTERVAL)
  buildMainMenu()
}
