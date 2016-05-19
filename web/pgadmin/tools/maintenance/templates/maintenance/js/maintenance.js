define(
  ['jquery', 'underscore', 'underscore.string', 'alertify', 'pgadmin',
  'pgadmin.browser', 'backbone', 'backgrid', 'backform',
  'pgadmin.backform', 'pgadmin.backgrid', 'pgadmin.browser.node.ui'],
  function($, _, S, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid, Backform) {

  pgAdmin = pgAdmin || window.pgAdmin || {};

  var pgTools = pgAdmin.Tools = pgAdmin.Tools || {};

  // Return back, this has been called more than once
  if (pgAdmin.Tools.maintenance)
    return pgAdmin.Tools.maintenance;

  var CustomSwitchControl = Backform.CustomSwitchControl = Backform.SwitchControl.extend({
      template: _.template([
        '<label class="<%=Backform.controlLabelClassName%> custom_switch_label_class"><%=label%></label>',
        '<div class="<%=Backform.controlsClassName%> custom_switch_control_class">',
        '  <div class="checkbox">',
        '    <label>',
        '      <input type="checkbox" class="<%=extraClasses.join(\' \')%>" name="<%=name%>" <%=value ? "checked=\'checked\'" : ""%> <%=disabled ? "disabled" : ""%> <%=required ? "required" : ""%> />',
        '    </label>',
        '  </div>',
        '</div>',
        '<% if (helpMessage && helpMessage.length) { %>',
        '  <span class="<%=Backform.helpMessageClassName%>"><%=helpMessage%></span>',
        '<% } %>'
      ].join("\n")),
      className: 'pgadmin-control-group form-group col-xs-6'
    });

  // Main model for Maintenance functionality
  var MaintenanceModel = Backbone.Model.extend({
    defaults: {
      op: 'VACUUM',
      vacuum_full: false,
      vacuum_freeze: false,
      vacuum_analyze: false,
      verbose: true
    },
    schema: [
      {
        id: 'op', label:'{{ _('Maintenance operation') }}', cell: 'string',
        type: 'text', group: '{{ _('Options') }}',
        options:[
          {'label': "VACUUM", 'value': "VACUUM"},
          {'label': "ANALYZE", 'value': "ANALYZE"},
          {'label': "REINDEX", 'value': "REINDEX"},
          {'label': "CLUSTER", 'value': "CLUSTER"},
        ],
        control: Backform.RadioControl.extend({
          template: _.template([
            '<label class="control-label col-sm-4 col-xs-12"><%=label%></label>',
            '<div class="pgadmin-controls col-xs-12 col-sm-8 btn-group pg-maintenance-op" data-toggle="buttons">',
            ' <% for (var i=0; i < options.length; i++) { %>',
            ' <% var option = options[i]; %>',
            ' <label class="btn btn-primary<% if (i == 0) { %> active<%}%>">',
            '  <input type="radio" name="op" id="op" autocomplete="off" value=<%-formatter.fromRaw(option.value)%><% if (i == 0) { %> selected<%}%> > <%-option.label%>',
            ' </label>',
            ' <% } %>',
            '</div>'
          ].join("\n"))
        }),
        select2: {
          allowClear: false,
          width: "100%",
          placeholder: '{{ _('Select from list...') }}'
        },
      },
      {
        type: 'nested', control: 'fieldset', label:'{{ _('Vacuum') }}', group: '{{ _('Options') }}',
        schema:[{
          id: 'vacuum_full', disabled: false, group: '{{ _('Vacuum') }}', disabled: 'isDisabled',
          control: Backform.CustomSwitchControl, label: '{{ _('FULL') }}', deps: ['op']
        },{
          id: 'vacuum_freeze', disabled: false, deps: ['op'], disabled: 'isDisabled',
          control: Backform.CustomSwitchControl, label: '{{ _('FREEZE') }}', group: '{{ _('Vacuum') }}'
        },{
          id: 'vacuum_analyze', disabled: false, deps: ['op'], disabled: 'isDisabled',
          control: Backform.CustomSwitchControl, label: '{{ _('ALALYZE') }}', group: '{{ _('Vacuum') }}'
        }]
      },
      {
        id: 'verbose', disabled: false, group: '{{ _('Options') }}', deps: ['op'],
        control: Backform.CustomSwitchControl, label: '{{ _('Verbose Messages') }}', disabled: 'isDisabled'
      }
    ],

    // Enable/Disable the items based on the user maintenance operation selection
    isDisabled: function(m) {
      name = this.name;
      switch(name) {
        case 'vacuum_full':
        case 'vacuum_freeze':
        case 'vacuum_analyze':
          if (m.get('op') != 'VACUUM') {
            return true;
          }
          else {
            return false;
          }
          break;
        case 'verbose':
          if (m.get('op') == 'REINDEX') {
            return true;
          }
          else {
            return false;
          }
          break;
        default:
          return false;
      }
      return false;
    }
  });

  pgTools.maintenance = {
      init: function() {

        // We do not want to initialize the module multiple times.
        if (this.initialized)
            return;

        this.initialized = true;

        var maintenance_supported_nodes = [
              'database', 'table'
            ];

        /**
         Enable/disable Maintenance menu in tools based on node selected.
         Maintenance menu will be enabled only when user select table and database node.
        */
        menu_enabled = function(itemData, item, data) {
         var t = pgBrowser.tree, i = item, d = itemData;
         var parent_item = t.hasParent(i) ? t.parent(i): null,
             parent_data = parent_item ? t.itemData(parent_item) : null;
           if(!_.isUndefined(d) && !_.isNull(d) && !_.isNull(parent_data))
             return (
               (_.indexOf(maintenance_supported_nodes, d._type) !== -1 &&
               parent_data._type != 'catalog') ? true: false
             );
           else
             return false;
        };

        var menus = [{
          name: 'maintenance', module: this,
          applies: ['tools'], callback: 'callback_maintenace',
          priority: 10, label: '{{ _('Maintenance...') }}',
          icon: 'fa fa-wrench', enable: menu_enabled
        }];

        // Add supported menus into the menus list
        for (var idx = 0; idx < maintenance_supported_nodes.length; idx++) {
          menus.push({
            name: 'maintenance_context_' + maintenance_supported_nodes[idx],
            node: maintenance_supported_nodes[idx], module: this,
            applies: ['context'], callback: 'callback_maintenace',
            priority: 10, label: '{{_("Maintenance...") }}',
            icon: 'fa fa-wrench', enable: menu_enabled
          });
        }
        pgBrowser.add_menus(menus);
      },

      /*
        Open the dialog for the maintenance functionality
      */
      callback_maintenace: function(args, item) {
        var self = this;
        var input = args || {},
          t = pgBrowser.tree,
          i = item || t.selected(),
          d = i && i.length == 1 ? t.itemData(i) : undefined,
          node = d && pgBrowser.Nodes[d._type];

        if (!d)
          return;

        var objName = d.label;
        var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);

        if (!Alertify.MaintenanceDialog) {
          Alertify.dialog('MaintenanceDialog', function factory() {

            return {
              main:function(title) {
                this.set('title', title);
              },
              setup:function() {
                return {
                  buttons:[{ text: "{{ _('OK') }}", key: 27, className: "btn btn-primary fa fa-lg fa-save pg-alertify-button" },
                       { text: "{{ _('Cancel') }}", key: 27, className: "btn btn-danger fa fa-lg fa-times pg-alertify-button" }],
                  options: { modal: 0}
                };
              },
              // Callback functions when click on the buttons of the Alertify dialogs
              callback: function(e) {
                if (e.button.text === "{{ _('OK') }}") {

                  var schema = '';
                  var table = '';
                  var i = pgBrowser.tree.selected(),
                  d = i && i.length == 1 ? pgBrowser.tree.itemData(i) : undefined,
                  node = d && pgBrowser.Nodes[d._type];

                  if (!d)
                    return;

                  var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);

                  if (treeInfo.schema != undefined) {
                    schema = treeInfo.schema.label;
                  }
                  if (treeInfo.table != undefined) {
                    table = treeInfo.table.label;
                  }

                  this.view.model.set({'database': treeInfo.database.label,
                                      'schema': schema,
                                      'table': table})

                    baseUrl = "{{ url_for('maintenance.index') }}" +
                    "create_job/" + treeInfo.server._id + "/" + treeInfo.database._id,
                    args =  this.view.model.toJSON();

                  $.ajax({
                    url: baseUrl,
                    method: 'POST',
                    data:{ 'data': JSON.stringify(args) },
                    success: function(res) {
                      if (res.data && res.data.status) {
                        //Do nothing as we are creating the job and exiting from the main dialog
                        Alertify.success(res.data.info);
                        pgBrowser.Events.trigger('pgadmin-bgprocess:created', self);
                      }
                      else {
                        Alertify.error(res.data.info);
                      }
                    },
                    error: function(e) {
                      Alertify.alert(
                        "{{ _('Maintenance job creation failed') }}"
                      );
                    }
                  });
                }
              },
              build:function() {

              },
              hooks: {
                onclose: function() {
                  if (this.view) {
                    this.view.remove({data: true, internal: true, silent: true});
                  }
                }
              },
              prepare:function() {
                // Main maintenance tool dialog container
                var $container = $("<div class='maintenance_dlg'></div>");

                var t = pgBrowser.tree,
                  i = t.selected(),
                  d = i && i.length == 1 ? t.itemData(i) : undefined,
                  node = d && pgBrowser.Nodes[d._type];

                if (!d)
                  return;

                var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);

                var newModel = new MaintenanceModel (
                  {}, {node_info: treeInfo}
                  ),
                  fields = Backform.generateViewSchema(
                    treeInfo, newModel, 'create', node, treeInfo.server, true
                  );

                  var view = this.view = new Backform.Dialog({
                    el: $container, model: newModel, schema: fields
                  });

                  $(this.elements.body.childNodes[0]).addClass('alertify_tools_dialog_properties obj_properties');

                  view.render();

                  this.elements.content.appendChild($container.get(0));
              }
            };
          });
        }

        // Open the Alertify dialog
        Alertify.MaintenanceDialog('Maintenance...').set('resizable',true).resizeTo('60%','80%');
      },
    };

    return pgAdmin.Tools.maintenance;
  });