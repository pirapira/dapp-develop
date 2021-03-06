// Copyright 2015-2017 Parity Technologies (UK) Ltd.
// This file is part of Parity.

// Parity is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Parity is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Parity.  If not, see <http://www.gnu.org/licenses/>.

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormattedMessage } from 'react-intl';
import { observer } from 'mobx-react';
import { connect } from 'react-redux';
import moment from 'moment';
import { throttle } from 'lodash';

import { Actionbar, ActionbarExport, ActionbarImport, Button, Dropdown, Input, Loading, Page, Toggle, Tab } from '@parity/ui';
import { CancelIcon, ListIcon, SaveIcon, SendIcon, SettingsIcon } from '@parity/ui/lib/Icons';
import Editor from '@parity/ui/lib/Editor';

import DeployContract from '@parity/dapp-contracts/src/DeployContract';
import LoadContract from './LoadContract';
import SaveContract from './SaveContract';

import ContractDevelopStore from './store';
import styles from './contractDevelop.css';

import { Debugger, TransactButton, Contract, DropdownBond } from 'parity-reactive-ui';
import { Bond } from 'oo7';
import { bonds } from 'oo7-parity';

const traceOptions = [{ text: 'trace', value: 'trace' }, { text: 'vmTrace', value: 'vmTrace' }, { text: 'stateDiff', value: 'stateDiff' }];

@observer
class ContractDevelop extends Component {
  static propTypes = {
    accounts: PropTypes.object.isRequired,
    worker: PropTypes.object,
    workerError: PropTypes.any
  };

  store = ContractDevelopStore.get();

  state = {
    resizing: false,
    size: 65
  };

  debugDeploy = this.debugDeploy.bind(this);

  componentWillMount () {
    const { worker } = this.props;

    if (worker !== undefined) {
      this.store.setWorker(worker);
    }
    this.throttledResize = throttle(this.applyResize, 100, { leading: true });
  }

  componentDidMount () {
    this.store.setEditor(this.refs.editor);

    if (this.props.workerError) {
      this.store.setWorkerError(this.props.workerError);
    }

    // Wait for editor to be loaded
    window.setTimeout(() => {
      this.store.resizeEditor();
    }, 2000);
  }

  // Set the worker if not set before (eg. first page loading)
  componentWillReceiveProps (nextProps) {
    if (this.props.worker === undefined && nextProps.worker !== undefined) {
      this.store.setWorker(nextProps.worker);
    }

    if (this.props.workerError !== nextProps.workerError) {
      this.store.setWorkerError(nextProps.workerError);
    }
  }

  render () {
    console.log('render contractDevelopment');
    const { sourcecode } = this.store;
    const { size, resizing } = this.state;

    const annotations = this.store.annotations
      .slice()
      .filter((a) => a.contract === '');

    const panes = [
      { menuItem: 'Parameters', render: () => <div>
        { this.renderParameters() }
      </div> },
      { menuItem: 'Debugger', render: () => <Tab panes={ [ { menuItem: 'Trace', render: () => this.renderDebugger() },
                                                           { menuItem: 'ShowTrace', render: () => <Debugger txBond={ this.store.contract.trace } /> } ] }
                                            />
      }
    ];

    return (
      <div className={ styles.outer }>
        { this.renderDeployModal() }
        { this.renderSaveModal() }
        { this.renderLoadModal() }
        { this.renderActionBar() }
        <Page className={ styles.page }>
          <div
            className={ `${styles.container} ${resizing ? styles.resizing : ''}` }
          >
            <div
              className={ styles.editor }
              style={ { flex: `${size}%` } }
            >
              <h2>{ this.renderTitle() }</h2>

              <Editor
                ref='editor'
                onChange={ this.store.handleEditSourcecode }
                onExecute={ this.store.handleCompile }
                annotations={ annotations }
                value={ sourcecode }
                className={ styles.mainEditor }
              />
            </div>

            <div className={ styles.sliderContainer }>
              <span
                className={ styles.slider }
                onMouseDown={ this.handleStartResize }
              />
            </div>

            <div
              className={ styles.parameters }
              style={ { flex: `${100 - size}%` } }
            >
              <Tab panes={ panes } />
            </div>
          </div>
        </Page>
      </div>
    );
  }

  renderTitle () {
    const { selectedContract } = this.store;

    if (!selectedContract || !selectedContract.name) {
      return (
        <FormattedMessage
          id='writeContract.title.new'
          defaultMessage='New Solidity Contract'
        />
      );
    }

    return (
      <span>
        { selectedContract.name }
        <span
          className={ styles.timestamp }
          title={
            <FormattedMessage
              id='writeContract.title.saved'
              defaultMessage='saved @ {timestamp}'
              vaules={ {
                timestamp: (new Date(selectedContract.timestamp)).toISOString()
              } }
            />
          }
        >
          <FormattedMessage
            id='writeContract.details.saved'
            defaultMessage='(saved {timestamp})'
            values={ {
              timestamp: moment(selectedContract.timestamp).fromNow()
            } }
          />
        </span>
      </span>
    );
  }

  debugDeploy (contract) {
    const { contracts, contractIndex } = this.store;

    const bytecode = contract.bytecode;
    const abi = contract.interface;

    if (!contract.deployed) {
      let tx = bonds.deployContract(bytecode, JSON.parse(abi));

      tx.done(s => {
        console.log('txDone!');
        // address is undefined from s (How to become ? => TuT) , error because of triggering while triggering => can makeContract call? between here and next printout
        let address = s.deployed.address;

        contract.deployed = bonds.makeContract(address, JSON.parse(abi), [], true);
        contract.address = address;
        contract.trace = new Bond();
        contract.trace.tie(v => {
          console.log('TIED to BOND', v);
          // v.then(console.log);
        });
        contracts[contractIndex] = contract;
        console.log('New Contract', contract, 'index', contractIndex);
      });

      return tx;
    } else {
      return null;
    }
  }

  renderDebugger () {
    const { contracts, compiled } = this.store;
    let traceMode = new Bond();

    const contractKeys = Object.keys(contracts);

    return (<div>
      {compiled ? <div>
        <DropdownBond bond={ traceMode } options={ traceOptions } fluid multiple />
        {contractKeys.map((name, i) => {
          let c = contracts[name];

          console.log('contract', c, 'index', i, 'name', name);

          return (
            <div key={ i }>
              { c.deployed
                ? <Contract
                  contract={ c.deployed ? c.deployed : null }
                  trace={ c.trace }
                  traceMode={ traceMode }
                  contractName={ `Contract ${name} ${c.address}` }
                  />
                : <TransactButton content={ `Debug ${name}` } tx={ () => this.debugDeploy(c) } statusText disabled={ c.deployed } />}
            </div>
          );
        })}
      </div> : null}
    </div>);
  }

  renderActionBar () {
    const { sourcecode, selectedContract } = this.store;

    const filename = selectedContract && selectedContract.name
      ? selectedContract.name
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/-$/, '')
        .toLowerCase()
      : 'contract.sol';

    const extension = /\.sol$/.test(filename) ? '' : '.sol';

    const buttons = [
      <Button
        icon={ <CancelIcon /> }
        label={
          <FormattedMessage
            id='writeContract.buttons.new'
            defaultMessage='New'
          />
        }
        key='newContract'
        onClick={ this.store.handleNewContract }
      />,
      <Button
        icon={ <ListIcon /> }
        label={
          <FormattedMessage
            id='writeContract.buttons.load'
            defaultMessage='Load'
          />
        }
        key='loadContract'
        onClick={ this.store.handleOpenLoadModal }
      />,
      <Button
        icon={ <SaveIcon /> }
        label={
          <FormattedMessage
            id='writeContract.buttons.save'
            defaultMessage='Save'
          />
        }
        key='saveContract'
        onClick={ this.store.handleSaveContract }
      />,
      <ActionbarExport
        key='exportSourcecode'
        content={ sourcecode }
        filename={ `${filename}${extension}` }
      />,
      <ActionbarImport
        key='importSourcecode'
        title={
          <FormattedMessage
            id='writeContract.buttons.import'
            defaultMessage='Import Solidity'
          />
        }
        onConfirm={ this.store.handleImport }
        renderValidation={ this.renderImportValidation }
      />
    ];

    return (
      <Actionbar
        title={
          <FormattedMessage
            id='writeContract.title.main'
            defaultMessage='Write a Contract'
          />
        }
        buttons={ buttons }
      />
    );
  }

  renderImportValidation = (content) => {
    return (
      <Editor
        readOnly
        value={ content }
        maxLines={ 20 }
      />
    );
  }

  renderParameters () {
    const { compiling, contract, selectedBuild, loading, workerError } = this.store;

    if (selectedBuild < 0) {
      return (
        <div className={ `${styles.panel} ${styles.centeredMessage}` }>
          <Loading />
          <p>
            <FormattedMessage
              id='writeContract.title.loading'
              defaultMessage='Loading...'
            />
          </p>
        </div>
      );
    }

    let content;

    if (workerError) {
      content = (
        <div className={ styles.panel }>
          <div className={ styles.centeredMessage }>
            <p>
              <FormattedMessage
                id='writeContract.error.params'
                defaultMessage='An error occurred with the following description'
              />
            </p>
            <div className={ styles.error }>
              { workerError.toString() }
            </div>
          </div>
        </div>
      );
    } else if (loading) {
      const { longVersion } = this.store.builds[selectedBuild];

      content = (
        <div className={ styles.panel }>
          <div className={ styles.centeredMessage }>
            <Loading />
            <p>
              <FormattedMessage
                id='writeContract.title.solidity'
                defaultMessage='Loading Solidity {version}'
                values={ {
                  version: longVersion
                } }
              />
            </p>
          </div>
        </div>
      );
    } else {
      content = this.renderCompilation();
    }

    return (
      <div className={ styles.panel }>
        <div>
          <Button
            icon={ <SettingsIcon /> }
            label={
              <FormattedMessage
                id='writeContract.buttons.compile'
                defaultMessage='Compile'
              />
            }
            onClick={ this.store.handleCompile }
            primary={ false }
            disabled={ compiling || this.store.isPristine }
          />
          {
            contract
              ? (
                <span>
                  <Button
                    disabled={ compiling || !this.store.isPristine }
                    icon={ <SendIcon /> }
                    label={
                      <FormattedMessage
                        id='writeContract.buttons.deploy'
                        defaultMessage='Deploy'
                      />
                    }
                    onClick={ this.store.handleOpenDeployModal }
                    primary={ false }
                  />
                </span>
            )
            : null
          }

        </div>
        <div className={ styles.toggles }>
          <div>
            <Toggle
              label={
                <FormattedMessage
                  id='writeContract.buttons.optimise'
                  defaultMessage='Optimise'
                />
              }
              labelPosition='right'
              onToggle={ this.store.handleOptimizeToggle }
              toggled={ this.store.optimize }
            />
          </div>
          <div>
            <Toggle
              label={
                <FormattedMessage
                  id='writeContract.buttons.autoCompile'
                  defaultMessage='Auto-Compile'
                />
              }
              labelPosition='right'
              onToggle={ this.store.handleAutocompileToggle }
              toggled={ this.store.autocompile }
            />
          </div>
        </div>
        { this.renderSolidityVersions() }
        { content }
      </div>
    );
  }

  renderSolidityVersions () {
    const { builds, selectedBuild } = this.store;

    return (
      <div>
        <Dropdown
          label={
            <FormattedMessage
              id='writeContract.title.selectSolidity'
              defaultMessage='Select a Solidity version'
            />
          }
          value={ selectedBuild }
          onChange={ this.store.handleSelectBuild }
          options={
            builds.map((build, index) => {
              return {
                key: index,
                text: build.release ? build.version : build.longVersion,
                value: index,
                content:
                  build.release
                    ? (
                      <span className={ styles.big }>
                        { build.version }
                      </span>
                    )
                    : build.longVersion
              };
            })
          }
        />
      </div>
    );
  }

  renderDeployModal () {
    const { showDeployModal, contract, sourcecode } = this.store;

    if (!showDeployModal) {
      return null;
    }

    return (
      <DeployContract
        abi={ contract.interface }
        accounts={ this.props.accounts }
        code={ `0x${contract.bytecode}` }
        source={ sourcecode }
        onClose={ this.store.handleCloseDeployModal }
        readOnly
      />
    );
  }

  renderLoadModal () {
    const { showLoadModal } = this.store;

    if (!showLoadModal) {
      return null;
    }

    return (
      <LoadContract
        onLoad={ this.store.handleLoadContract }
        onDelete={ this.store.handleDeleteContract }
        onClose={ this.store.handleCloseLoadModal }
        contracts={ this.store.savedContracts }
        snippets={ this.store.snippets }
      />
    );
  }

  renderSaveModal () {
    const { showSaveModal, sourcecode } = this.store;

    if (!showSaveModal) {
      return null;
    }

    return (
      <SaveContract
        sourcecode={ sourcecode }
        onSave={ this.store.handleSaveNewContract }
        onClose={ this.store.handleCloseSaveModal }
      />
    );
  }

  renderCompilation () {
    const { compiled, contracts, compiling, contractIndex, contract } = this.store;

    if (compiling) {
      return (
        <div className={ styles.centeredMessage }>
          <Loading />
          <p>
            <FormattedMessage
              id='writeContract.compiling.busy'
              defaultMessage='Compiling...'
            />
          </p>
        </div>
      );
    }

    if (!compiled) {
      return (
        <div className={ styles.centeredMessage }>
          <p>
            <FormattedMessage
              id='writeContract.compiling.action'
              defaultMessage='Please compile the source code.'
            />
          </p>
        </div>
      );
    }

    if (!contracts) {
      return this.renderErrors();
    }

    const contractKeys = Object.keys(contracts);

    if (contractKeys.length === 0) {
      return (
        <div className={ styles.centeredMessage }>
          <p>
            <FormattedMessage
              id='writeContract.error.noContract'
              defaultMessage='No contract has been found.'
            />
          </p>
        </div>
      );
    }

    return (
      <div className={ styles.compilation }>
        <Dropdown
          label={
            <FormattedMessage
              id='writeContract.title.contract'
              defaultMessage='Select a contract'
            />
          }
          value={ contractIndex }
          onChange={ this.store.handleSelectContract }
          options={
            contractKeys.map((name, index) => {
              return {
                key: index,
                value: index,
                text: name
              };
            })
          }
        />
        { this.renderContract(contract) }
        <h4 className={ styles.messagesHeader }>
          <FormattedMessage
            id='writeContract.title.messages'
            defaultMessage='Compiler messages'
          />
        </h4>
        { this.renderErrors() }
      </div>
    );
  }

  renderContract (contract) {
    if (!contract) {
      return null;
    }

    const { bytecode } = contract;
    const abi = contract.interface;

    const metadata = contract.metadata
      ? (
        <Input
          allowCopy
          label={
            <FormattedMessage
              id='writeContract.input.metadata'
              defaultMessage='Metadata'
            />
          }
          readOnly
          value={ contract.metadata }
        />
      )
      : null;

    return (
      <div>
        <Input
          allowCopy
          label={
            <FormattedMessage
              id='writeContract.input.abi'
              defaultMessage='ABI Definition'
            />
          }
          readOnly
          value={ abi }
        />

        <Input
          allowCopy
          label={
            <FormattedMessage
              id='writeContract.input.code'
              defaultMessage='Bytecode'
            />
          }
          readOnly
          value={ `0x${bytecode}` }
        />

        { metadata }
        { this.renderSwarmHash(contract) }
      </div>
    );
  }

  renderSwarmHash (contract) {
    if (!contract || !contract.metadata) {
      return null;
    }

    const { bytecode } = contract;

    // @see https://solidity.readthedocs.io/en/develop/miscellaneous.html#encoding-of-the-metadata-hash-in-the-bytecode
    const hashRegex = /a165627a7a72305820([a-f0-9]{64})0029$/;

    if (!hashRegex.test(bytecode)) {
      return null;
    }

    const hash = hashRegex.exec(bytecode)[1];

    return (
      <Input
        allowCopy
        label={
          <FormattedMessage
            id='writeContract.input.swarm'
            defaultMessage='Swarm Metadata Hash'
          />
        }
        readOnly
        value={ `${hash}` }
      />
    );
  }

  renderErrors () {
    const { annotations } = this.store;

    const body = annotations.map((annotation, index) => {
      const { text, row, column, contract, type, formal } = annotation;
      const classType = formal ? 'formal' : type;
      const classes = [ styles.message, styles[classType] ];

      return (
        <div key={ index } className={ styles.messageContainer }>
          <div className={ classes.join(' ') }>{ text }</div>
          <span className={ styles.errorPosition }>
            { contract ? `[ ${contract} ]   ` : '' }
            { row }: { column }
          </span>
        </div>
      );
    });

    return (
      <div className={ styles.errors }>
        { body }
      </div>
    );
  }

  handleStartResize = () => {
    this.setState({ resizing: true });
  }

  handleStopResize = () => {
    this.setState({ resizing: false });
  }

  handleResize = (event) => {
    if (!this.state.resizing) {
      return;
    }

    const { pageX, currentTarget } = event;
    const { width, left } = currentTarget.getBoundingClientRect();

    const x = pageX - left;

    this.size = 100 * x / width;
    this.throttledResize();

    event.stopPropagation();
  }

  applyResize = () => {
    this.setState({ size: this.size });
  }
}

function mapStateToProps (state) {
  const { accounts } = state.personal;
  const { worker, error } = state.worker;

  return {
    accounts,
    worker,
    workerError: error
  };
}

export default connect(
mapStateToProps,
null
)(ContractDevelop);
